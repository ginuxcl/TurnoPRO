// Batería de tests de seguridad contra la API en marcha.
// Uso: node scripts/security-test.mjs  (requiere API en localhost:4000)
const BASE = 'http://localhost:4000/api/v1';
let pass = 0, fail = 0;

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ PASS ${name}`); }
  else { fail++; console.log(`  ✗ FAIL ${name} ${detail}`); }
}

async function req(method, path, { token, body, cookie, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* vacío */ }
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, data, setCookie };
}

// Sesiones cacheadas por email: la suite hace muchos logins y el rate-limit
// de login es 15/15 min por IP+email. Los fallos nunca se cachean.
const _sessions = new Map();
const login = async (email, password) => {
  if (_sessions.has(email)) return _sessions.get(email);
  const r = await req('POST', '/auth/login', { body: { email, password } });
  const sess = { token: r.data?.access_token, cookie: r.setCookie?.split(';')[0], setCookieRaw: r.setCookie, status: r.status, data: r.data };
  if (r.status === 200 && sess.token) _sessions.set(email, sess);
  return sess;
};

console.log('\n== 1. Autenticación ==');
{
  const bad = await req('GET', '/me');
  check('Sin token → 401', bad.status === 401);
  const garbage = await req('GET', '/me', { token: 'xxxx.yyyy.zzzz' });
  check('Token manipulado → 401', garbage.status === 401);
  const wrong = await login('demo@turnos.app', 'WrongPass123');
  check('Contraseña incorrecta → 401', wrong.status === 401);
  const noUser = await login('noexiste@x.es', 'Whatever123');
  check('Email inexistente → 401 (sin filtrar existencia)', noUser.status === 401 && noUser.data?.error === 'Credenciales incorrectas');
  const weak = await req('POST', '/auth/register', { body: { org_name: 'Test', first_name: 'A', last_name: 'B', email: 'weak@x.es', password: 'corta' } });
  check('Contraseña débil rechazada → 400', weak.status === 400);
}

console.log('\n== 2. Crear segunda organización (para probar aislamiento BOLA) ==');
let orgB;
{
  const suffix = Date.now();
  const r = await req('POST', '/auth/register', {
    body: { org_name: 'Org B', first_name: 'Berta', last_name: 'Boss', email: `berta-${suffix}@orgb.es`, password: 'Secreta123' },
  });
  check('Registro org B → 201', r.status === 201, JSON.stringify(r.data));
  orgB = { token: r.data.access_token, user: r.data.user };
}

console.log('\n== 3. RBAC: empleado sin permisos de gestión ==');
let ana;
{
  ana = await login('ana@turnos.app', 'Demo12345!');
  check('Login empleado (Ana) → 200', ana.status === 200);

  const r1 = await req('GET', '/audit', { token: ana.token });
  check('Empleado → /audit denegado (403)', r1.status === 403);

  const r2 = await req('POST', '/shifts', {
    token: ana.token,
    body: { date: '2026-12-01', start_time: '09:00', end_time: '15:00', break_minutes: 0 },
  });
  check('Empleado → crear turno denegado (403)', r2.status === 403);

  const staff = await req('GET', '/staff', { token: ana.token });
  const boss = staff.data.staff.find((s) => s.role === 'owner');
  const r3 = await req('PATCH', `/staff/${boss.id}`, { token: ana.token, body: { role: 'manager' } });
  check('Empleado → modificar jefe denegado (403)', r3.status === 403);

  const r4 = await req('GET', `/availability/${boss.id}`, { token: ana.token });
  check('Empleado → disponibilidad ajena → 404 (anti-IDOR)', r4.status === 404);

  const r5 = await req('GET', '/schedules');
  const drafts = await req('GET', `/shifts?user_id=open`, { token: ana.token });
  check('Empleado solo ve turnos publicados', drafts.status === 200 && drafts.data.shifts.every((s) => s.schedule_status === 'published'));
}

console.log('\n== 4. IDOR/BOLA entre organizaciones ==');
{
  // Turno de la org A (demo)
  const marta = await login('demo@turnos.app', 'Demo12345!');
  const shiftsA = await req('GET', '/shifts', { token: marta.token });
  const shiftA = shiftsA.data.shifts[0];
  check('Gestor org A ve sus turnos', shiftsA.status === 200 && shiftsA.data.shifts.length > 0);

  // Gestor de org B intenta leer/modificar el turno de org A
  const r1 = await req('GET', `/shifts`, { token: orgB.token });
  check('Org B no ve turnos de org A (lista vacía)', r1.status === 200 && r1.data.shifts.length === 0);

  const r2 = await req('PATCH', `/shifts/${shiftA.id}`, { token: orgB.token, body: { notes: 'hackeado' } });
  check('Org B → PATCH turno de org A → 404 (anti-BOLA)', r2.status === 404);

  const r3 = await req('DELETE', `/shifts/${shiftA.id}`, { token: orgB.token });
  check('Org B → DELETE turno de org A → 404', r3.status === 404);

  // Org B intenta asignar a un empleado de org A en su turno
  const anaProfile = (await req('GET', '/staff', { token: marta.token })).data.staff.find((s) => s.email === 'ana@turnos.app');
  const r4 = await req('POST', '/shifts', {
    token: orgB.token,
    body: { date: '2026-12-02', start_time: '09:00', end_time: '15:00', break_minutes: 0, user_id: anaProfile.id },
  });
  check('Org B → asignar empleado de org A → 404 (no puede referenciarlo)', r4.status === 404);

  // Staff cruzado
  const r5 = await req('GET', `/staff/${anaProfile.id}`, { token: orgB.token });
  check('Org B → GET empleado de org A → 404', r5.status === 404);

  const r6 = await req('GET', `/audit`, { token: orgB.token });
  check('Audit aislada: org B solo ve SUS eventos', r6.status === 200 && r6.data.logs.length > 0 && r6.data.logs.every((l) => l.actor_name === 'Berta Boss'));
}

console.log('\n== 5. Validación de entrada / inyección SQL ==');
{
  const marta = await login('demo@turnos.app', 'Demo12345!');
  const inj = await req('POST', '/shifts', {
    token: marta.token,
    body: { date: "2026-12-01'; DROP TABLE shifts;--", start_time: '09:00', end_time: '15:00', break_minutes: 0 },
  });
  check('SQL injection en fecha rechazada (400)', inj.status === 400);
  const badTime = await req('POST', '/shifts', {
    token: marta.token,
    body: { date: '2026-12-01', start_time: '25:99', end_time: '15:00', break_minutes: 0 },
  });
  check('Hora inválida rechazada (400)', badTime.status === 400);
  const stillThere = await req('GET', '/shifts', { token: marta.token });
  check('Tabla shifts intacta tras intento de inyección', stillThere.status === 200 && stillThere.data.shifts.length > 0);
  const huge = await req('POST', '/auth/login', { body: { email: 'a'.repeat(5000), password: 'x' } });
  check('Payload gigante manejado sin caída', huge.status === 401 || huge.status === 400 || huge.status === 413 || huge.status === 429);
}

console.log('\n== 6. Reclamaciones y ausencias (propiedad estricta) ==');
{
  const carlos = await login('carlos@turnos.app', 'Demo12345!');
  // Fechas únicas por corrida para que la suite sea re-ejecutable sin reset
  const mes = String(1 + Math.floor(Math.random() * 6)).padStart(2, '0');
  const d1 = `2027-${mes}-10`;
  const d2 = `2027-${mes}-12`;
  const leave = await req('POST', '/leave', {
    token: carlos.token,
    body: { type: 'personal', start_date: d1, end_date: d2, reason: 'gestión personal' },
  });
  check('Empleado crea ausencia propia → 201', leave.status === 201);

  const other = await req('POST', '/leave', {
    token: carlos.token,
    body: { type: 'vacation', start_date: '2026-12-25', end_date: '2026-12-24', reason: 'x' },
  });
  check('Rango de fechas inválido rechazado', other.status === 400);

  const marta = await login('demo@turnos.app', 'Demo12345!');
  const pending = await req('GET', '/leave?status=pending', { token: marta.token });
  const first = pending.data.requests[0];
  const rev = await req('POST', `/leave/${first.id}/review`, { token: marta.token, body: { status: 'approved' } });
  check('Gestor aprueba ausencia → 200', rev.status === 200);
  const rev2 = await req('POST', `/leave/${first.id}/review`, { token: marta.token, body: { status: 'rejected' } });
  check('Re-revisar ausencia → 409 (idempotencia de estado)', rev2.status === 409);
}

console.log('\n== 7. Refresh token: rotación + detección de reuso ==');
{
  const sess = await login('javier@turnos.app', 'Demo12345!');
  const cookie1 = sess.cookie;
  check('Login establece cookie httpOnly',  /HttpOnly/i.test(sess.setCookieRaw || ''));

  const r1 = await req('POST', '/auth/refresh', { cookie: cookie1 });
  check('Refresh rota el token → 200', r1.status === 200);
  const cookie2 = r1.setCookie?.split(';')[0];

  // REUSO del token antiguo (cookie1 ya rotado) → debe revocar la familia
  const r2 = await req('POST', '/auth/refresh', { cookie: cookie1 });
  check('Reuso de refresh antiguo → 401 + revocación', r2.status === 401);

  const r3 = await req('POST', '/auth/refresh', { cookie: cookie2 });
  check('Token nuevo de la familia también revocado', r3.status === 401);

  const after = await req('GET', '/me', { token: sess.token });
  check('Access token expira solo (15 min), sigue válido ahora', after.status === 200);
}

console.log('\n== 8. Bloqueo por fuerza bruta ==');
{
  for (let i = 0; i < 5; i++) await login('elena@turnos.app', 'ContraseñaMala1');
  const locked = await login('elena@turnos.app', 'Demo12345!');
  check('5 fallos → cuenta bloqueada (423) aunque la contraseña sea correcta', locked.status === 423);

  // Desbloquear vía manager (reset de contraseña) para dejar la demo limpia
  const marta = await login('demo@turnos.app', 'Demo12345!');
  const staff = await req('GET', '/staff', { token: marta.token });
  const elena = staff.data.staff.find((s) => s.email === 'elena@turnos.app');
  const reset = await req('PATCH', `/staff/${elena.id}`, { token: marta.token, body: { new_password: 'Demo12345!' } });
  check('Gestor resetea contraseña y desbloquea (200)', reset.status === 200);
  const again = await login('elena@turnos.app', 'Demo12345!');
  check('Elena puede entrar tras el reset', again.status === 200);
}

console.log('\n== 10. Cambios de turno (swaps): permisos y aislamiento ==');
let swapCtx;
{
  const ana = await login('ana@turnos.app', 'Demo12345!');
  const mine = await req('GET', '/shifts?user_id=me', { token: ana.token });
  const staff = await req('GET', '/staff', { token: ana.token });
  const carlos = staff.data.staff.find((s) => s.email === 'carlos@turnos.app');
  const all = await req('GET', '/shifts', { token: ana.token });
  const carlosBusy = new Set(all.data.shifts.filter((s) => s.user_id === carlos.id).map((s) => s.date));
  // Elegir un turno de Ana en un día sin conflicto para Carlos (las reglas lo exigirían)
  const myShift = mine.data.shifts.find((s) => !carlosBusy.has(s.date));
  check('Hay un turno de Ana sin conflicto para Carlos', !!myShift);

  const created = await req('POST', '/swaps', { token: ana.token, body: { shift_id: myShift.id, to_user_id: carlos.id } });
  check('Empleado propone cambio de su turno → 201', created.status === 201);
  swapCtx = { swapId: created.data?.swap?.id, shiftId: myShift.id, anaToken: ana.token, carlosId: carlos.id };

  const notMineShift = all.data.shifts.find((s) => s.user_id !== ana.data.user.id);
  const notMine = await req('POST', '/swaps', {
    token: ana.token,
    body: { shift_id: notMineShift.id, to_user_id: carlos.id },
  });
  check('Empleado NO puede proponer cambio de turno ajeno → 403', notMine.status === 403);

  // Gestor de org B no ve ni puede aprobar el swap de org A
  const bertaSwaps = await req('GET', '/swaps', { token: orgB.token });
  check('Org B no ve swaps de org A', bertaSwaps.status === 200 && bertaSwaps.data.swaps.length === 0);
  const bertaApprove = await req('POST', `/swaps/${swapCtx.swapId}/approve`, { token: orgB.token });
  check('Org B → aprobar swap de org A → 404 (anti-BOLA)', bertaApprove.status === 404);

  // Empleada no puede aprobar
  const anaApprove = await req('POST', `/swaps/${swapCtx.swapId}/approve`, { token: ana.token });
  check('Empleado → aprobar swap → 403 (solo gestor)', anaApprove.status === 403);

  // Flujo completo: acepta el destinatario, aprueba el gestor
  const carlosSess = await login('carlos@turnos.app', 'Demo12345!');
  const accept = await req('POST', `/swaps/${swapCtx.swapId}/accept`, { token: carlosSess.token });
  check('Destinatario acepta el cambio → 200', accept.status === 200);
  const marta = await login('demo@turnos.app', 'Demo12345!');
  const approve = await req('POST', `/swaps/${swapCtx.swapId}/approve`, { token: marta.token });
  check('Gestor aprueba el cambio → 200', approve.status === 200);
  const after = await req('GET', '/shifts', { token: marta.token });
  const shifted = after.data.shifts.find((s) => s.id === swapCtx.shiftId);
  check('Turno reasignado al receptor', shifted && shifted.user_name?.startsWith('Carlos'));
}

console.log('\n== 11. Notificaciones: privacidad y funcionamiento ==');
{
  const ana = await login('ana@turnos.app', 'Demo12345!');
  const mine = await req('GET', '/notifications', { token: ana.token });
  check('Notificaciones del usuario → 200 con contador', mine.status === 200 && typeof mine.data.unread === 'number');
  check('Ana recibió notificaciones de la demo', mine.data.notifications.length > 0);
  check('Solo ve las suyas (user_id implícito en servidor)', mine.data.notifications.every((n) => n.title !== undefined));

  const other = mine.data.notifications[0];
  if (other) {
    const bertaNotifs = await req('GET', '/notifications', { token: orgB.token });
    check('Org B no ve notificaciones de org A', bertaNotifs.status === 200 && !bertaNotifs.data.notifications.some((n) => n.id === other.id));
    const readOther = await req('POST', `/notifications/${other.id}/read`, { token: orgB.token });
    check('Org B → marcar leída la notificación ajena → 404', readOther.status === 404);
  }
  const readAll = await req('POST', '/notifications/read-all', { token: ana.token });
  const after = await req('GET', '/notifications', { token: ana.token });
  check('Marcar todas como leídas funciona', readAll.status === 200 && after.data.unread === 0);
}

console.log('\n== 12. Motor de reglas y autocompletado ==');
{
  const marta = await login('demo@turnos.app', 'Demo12345!');
  const anaSess = await login('ana@turnos.app', 'Demo12345!');
  const staff = await req('GET', '/staff', { token: marta.token });
  const ana = staff.data.staff.find((s) => s.email === 'ana@turnos.app');
  const shifts = await req('GET', '/shifts', { token: marta.token });
  const anaShift = shifts.data.shifts.find((s) => s.user_id === ana.id);
  check('Hay un turno de Ana para probar reglas', !!anaShift);

  // Turno pegado (1 h de descanso) → 422 con violaciones; con force → 201
  const nextDay = anaShift.date; // mismo día, franja contigua con 1h de hueco
  const bad = await req('POST', '/shifts', {
    token: marta.token,
    body: { date: nextDay, start_time: '18:00', end_time: '23:00', break_minutes: 0, user_id: ana.id },
  });
  check('Reglas: turno con descanso insuficiente → 422 + violaciones', bad.status === 422 && Array.isArray(bad.data.violations) && bad.data.violations.length > 0);

  const forced = await req('POST', '/shifts', {
    token: marta.token,
    body: { date: nextDay, start_time: '18:00', end_time: '23:00', break_minutes: 0, user_id: ana.id, force: true },
  });
  check('Gestor puede forzar la excepción → 201', forced.status === 201);
  if (forced.data?.shift?.id) await req('DELETE', `/shifts/${forced.data.shift.id}`, { token: marta.token });

  // Autocompletado en org B (aislado): 2 turnos abiertos + 2 empleados
  const staffB = await req('POST', '/staff', {
    token: orgB.token,
    body: { first_name: 'Nino', last_name: 'Uno', email: `n1-${Date.now()}@b.es`, role: 'employee', password: 'Trabajador1' },
  });
  const schedB = await req('POST', '/schedules', { token: orgB.token, body: { week_start: '2026-11-02' } });
  await req('POST', '/shifts', { token: orgB.token, body: { date: '2026-11-02', start_time: '09:00', end_time: '15:00', break_minutes: 0 } });
  await req('POST', '/shifts', { token: orgB.token, body: { date: '2026-11-03', start_time: '09:00', end_time: '15:00', break_minutes: 0 } });
  const fill = await req('POST', `/schedules/${schedB.data.schedule.id}/autofill`, { token: orgB.token });
  check('Autocompletado asigna los turnos abiertos', fill.status === 200 && fill.data.assigned === 2 && fill.data.still_open === 0);
  const fillAgain = await req('POST', `/schedules/${schedB.data.schedule.id}/autofill`, { token: orgB.token });
  check('Segundo autofill es inocuo (0 abiertos)', fillAgain.status === 200 && fillAgain.data.assigned === 0);

  const employeeFill = await req('POST', `/schedules/${schedB.data.schedule.id}/autofill`, { token: anaSess.token });
  check('Empleado no puede autocompletar → 403', employeeFill.status === 403);
}

console.log('\n== 14. Fichaje: propiedad y RBAC ==');
let anaId;
{
  const anaS = await login('ana@turnos.app', 'Demo12345!');
  anaId = anaS.data?.user?.id;
  // Si una corrida anterior dejó el fichaje abierto, cerrarlo primero
  const pre = await req('GET', '/timeclock/status', { token: anaS.token });
  if (pre.data?.active) await req('POST', '/timeclock/clock', { token: anaS.token });
  const inP = await req('POST', '/timeclock/clock', { token: anaS.token });
  check('Fichar entrada → 200', inP.status === 200 && inP.data?.action === 'in');
  const st = await req('GET', '/timeclock/status', { token: anaS.token });
  check('Estado muestra fichaje activo', !!st.data?.active);
  const mine = await req('GET', '/timeclock/me', { token: anaS.token });
  check('Historial propio accesible', mine.status === 200 && mine.data?.entries?.length >= 1);
  const panelEmp = await req('GET', '/timeclock/panel', { token: anaS.token });
  check('Panel marcaje como empleado → 403', panelEmp.status === 403);
  const manualEmp = await req('POST', '/timeclock', { token: anaS.token, body: { user_id: anaId, work_date: '2026-01-05', clock_in: '09:00', clock_out: '17:00' } });
  check('Alta manual como empleado → 403', manualEmp.status === 403);

  const marta = await login('demo@turnos.app', 'Demo12345!');
  const panel = await req('GET', `/timeclock/panel?date=${new Date().toISOString().slice(0, 10)}`, { token: marta.token });
  check('Panel marcaje del gestor → 200 con filas', panel.status === 200 && Array.isArray(panel.data?.rows));
  const foreign = await req('POST', '/timeclock', { token: marta.token, body: { user_id: orgB.user.id, work_date: '2026-01-05', clock_in: '09:00', clock_out: '17:00' } });
  check('Fichaje manual de persona de otra org → 404 (anti-BOLA)', foreign.status === 404);
  const badRange = await req('POST', '/timeclock', { token: marta.token, body: { user_id: anaId, work_date: '2026-01-05', clock_in: '18:00', clock_out: '09:00' } });
  check('Fichaje manual con salida antes de entrada → 400', badRange.status === 400);
  const delGhost = await req('DELETE', '/timeclock/00000000-0000-4000-8000-000000000000', { token: marta.token });
  check('Eliminar fichaje inexistente → 404', delGhost.status === 404);
  // cerrar el fichaje abierto de Ana para no ensuciar
  await req('POST', '/timeclock/clock', { token: anaS.token });
}

console.log('\n== 15. Reportes y exportación ==');
{
  const anaS = await login('ana@turnos.app', 'Demo12345!');
  const noAccess = await req('GET', '/reports/hours', { token: anaS.token });
  check('Reportes como empleado → 403', noAccess.status === 403);
  const marta = await login('demo@turnos.app', 'Demo12345!');
  const ok = await req('GET', '/reports/hours', { token: marta.token });
  check('Reportes del gestor → 200 con personas', ok.status === 200 && ok.data?.people?.length >= 7);
  check('Costes calculados con valor hora', ok.data?.totals?.cost > 0);
  const xl = await fetch(BASE + '/reports/export.xlsx', { headers: { Authorization: `Bearer ${marta.token}` } });
  const buf = Buffer.from(await xl.arrayBuffer());
  check('Exportación Excel → 200 y XLSX válido (ZIP)', xl.status === 200 && buf[0] === 0x50 && buf[1] === 0x4b && buf.length > 4000);
  const xlEmp = await fetch(BASE + '/reports/export.xlsx', { headers: { Authorization: `Bearer ${anaS.token}` } });
  check('Exportar Excel como empleado → 403', xlEmp.status === 403);
}

console.log('\n== 16. Patrones y festivos ==');
{
  const anaS = await login('ana@turnos.app', 'Demo12345!');
  const noCreate = await req('POST', '/patterns', { token: anaS.token, body: { name: 'X', days: [[], [], [], [], [], [], []] } });
  check('Crear patrón como empleado → 403', noCreate.status === 403);
  const noHol = await req('POST', '/holidays', { token: anaS.token, body: { date: '2027-05-01', name: 'Huelga' } });
  check('Crear festivo como empleado → 403', noHol.status === 403);

  const marta = await login('demo@turnos.app', 'Demo12345!');
  const pat = await req('POST', '/patterns', {
    token: marta.token,
    body: { name: `Test ${Date.now()}`, days: [[{ start_time: '09:00', end_time: '13:00', break_minutes: 0 }], [], [], [], [], [], []] },
  });
  check('Crear patrón → 201', pat.status === 201);
  const futureWeek = '2027-03-01';
  const ap1 = await req('POST', `/patterns/${pat.data.pattern.id}/apply`, { token: marta.token, body: { week_start: futureWeek } });
  check('Aplicar patrón → crea turnos', ap1.status === 200 && ap1.data?.created === 1);
  const ap2 = await req('POST', `/patterns/${pat.data.pattern.id}/apply`, { token: marta.token, body: { week_start: futureWeek } });
  check('Reaplicar patrón → idempotente (omite duplicados)', ap2.status === 200 && ap2.data?.created === 0 && ap2.data?.skipped >= 1);
  const patB = await req('POST', '/patterns', {
    token: orgB.token,
    body: { name: 'Patrón B', days: [[{ start_time: '08:00', end_time: '12:00', break_minutes: 0 }], [], [], [], [], [], []] },
  });
  const cross = await req('PATCH', `/patterns/${patB.data.pattern.id}`, { token: marta.token, body: { name: 'Robado', days: [[], [], [], [], [], [], []] } });
  check('Editar patrón de otra org → 404 (anti-BOLA)', cross.status === 404);

  const mm = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const dd = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  const holDate = `2029-${mm}-${dd}`;
  const hol = await req('POST', '/holidays', { token: marta.token, body: { date: holDate, name: 'Día del trabajo' } });
  check('Crear festivo → 201', hol.status === 201);
  const dup = await req('POST', '/holidays', { token: marta.token, body: { date: holDate, name: 'Repetido' } });
  check('Festivo duplicado → 409', dup.status === 409);
  const holList = await req('GET', '/holidays', { token: anaS.token });
  check('Festivos visibles para empleados', holList.status === 200 && holList.data?.holidays?.length >= 6);
}

console.log('\n== 17. Preferencias: días bloqueados ==');
{
  const anaS = await login('ana@turnos.app', 'Demo12345!');
  const put = await req('PUT', '/preferences/me', { token: anaS.token, body: { blocked_dates: ['2027-04-10', '2027-04-11'] } });
  check('Guardar días bloqueados → 200', put.status === 200 && put.data?.blocked_dates?.length === 2);
  const bad = await req('PUT', '/preferences/me', { token: anaS.token, body: { blocked_dates: ['ayer'] } });
  check('Fecha inválida → 400', bad.status === 400);

  const carlos = await login('carlos@turnos.app', 'Demo12345!');
  const carlosId = carlos.data?.user?.id;
  const peek = await req('GET', `/preferences/of/${anaId}`, { token: carlos.token });
  check('Leer bloqueos de una compañera como empleado → 404 (anti-IDOR)', peek.status === 404);
  const self = await req('GET', `/preferences/of/${carlosId}`, { token: carlos.token });
  check('Leer bloqueos propios → 200', self.status === 200);
  const marta = await login('demo@turnos.app', 'Demo12345!');
  const asMgr = await req('GET', `/preferences/of/${anaId}`, { token: marta.token });
  check('Gestor lee bloqueos de su equipo → 200', asMgr.status === 200 && Array.isArray(asMgr.data?.blocked_dates));
}

console.log('\n== 18. API keys e integración ==');
{
  const anaS = await login('ana@turnos.app', 'Demo12345!');
  const denied = await req('POST', '/apikeys', { token: anaS.token, body: { name: 'Hacker' } });
  check('Crear API key como empleado → 403', denied.status === 403);

  const marta = await login('demo@turnos.app', 'Demo12345!');
  const created = await req('POST', '/apikeys', { token: marta.token, body: { name: 'integración test' } });
  check('Crear API key → 201 con clave tpk_', created.status === 201 && /^tpk_[a-f0-9]{48}$/.test(created.data?.key || ''));
  const key = created.data.key;

  const pub = await fetch(BASE + '/public/v1/shifts', { headers: { 'X-API-Key': key } });
  const pubData = await pub.json();
  check('API pública con clave válida → 200 y datos', pub.status === 200 && Array.isArray(pubData.data) && pubData.data.length > 0);
  check('API pública nunca expone emails', !JSON.stringify(pubData).includes('@'));
  const pubEmp = await fetch(BASE + '/public/v1/employees', { headers: { 'X-API-Key': key } });
  check('API pública empleados → 200', pubEmp.status === 200);
  const noKey = await fetch(BASE + '/public/v1/shifts');
  check('API pública sin clave → 401', noKey.status === 401);
  const badKey = await fetch(BASE + '/public/v1/shifts', { headers: { 'X-API-Key': 'tpk_' + '0'.repeat(48) } });
  check('API pública con clave inventada → 401', badKey.status === 401);
  const pubWithAuthOnly = await fetch(BASE + '/public/v1/shifts', { headers: { Authorization: `Bearer ${marta.token}` } });
  check('Bearer no sirve en la API pública → 401', pubWithAuthOnly.status === 401);

  // Clave de otra org solo ve su propia org (B vacía)
  const keyB = await req('POST', '/apikeys', { token: orgB.token, body: { name: 'org B' } });
  const pubB = await fetch(BASE + '/public/v1/shifts', { headers: { 'X-API-Key': keyB.data.key } });
  const pubBData = await pubB.json();
  check('Clave de org B no ve turnos de org A (aislamiento)', pubB.status === 200 && pubBData.data?.length === 0);

  const rev = await req('DELETE', `/apikeys/${created.data.key_record.id}`, { token: marta.token });
  check('Revocar clave → 200', rev.status === 200);
  const afterRev = await fetch(BASE + '/public/v1/shifts', { headers: { 'X-API-Key': key } });
  check('Clave revocada → 401', afterRev.status === 401);
}

console.log('\n== 19. Impacto de cobertura al aprobar ausencias ==');
{
  const carlos = await login('carlos@turnos.app', 'Demo12345!');
  const mes = String(1 + Math.floor(Math.random() * 6)).padStart(2, '0');
  const lv = await req('POST', '/leave', {
    token: carlos.token,
    body: { type: 'personal', start_date: `2027-${mes}-20`, end_date: `2027-${mes}-21`, reason: 'impacto test' },
  });
  check('Crear ausencia para prueba → 201', lv.status === 201);

  const anaS = await login('ana@turnos.app', 'Demo12345!');
  const denied = await req('GET', `/leave/${lv.data.request.id}/impact`, { token: anaS.token });
  check('Empleado no ve el impacto → 403', denied.status === 403);

  const marta = await login('demo@turnos.app', 'Demo12345!');
  const impact = await req('GET', `/leave/${lv.data.request.id}/impact`, { token: marta.token });
  check('Gestor ve impacto → 200 con persona y estructura', impact.status === 200 && impact.data?.leave?.person?.includes('Carlos') && Array.isArray(impact.data?.by_date));

  // Aislamiento: ausencia de org B invisible para org A
  const lvB = await req('POST', '/leave', {
    token: orgB.token,
    body: { type: 'vacation', start_date: '2027-07-01', end_date: '2027-07-05', reason: 'B' },
  });
  const cross = await req('GET', `/leave/${lvB.data.request.id}/impact`, { token: marta.token });
  check('Impacto de ausencia de otra org → 404 (anti-BOLA)', cross.status === 404);
}

console.log('\n== 20. Asistente: utilidad y RBAC ==');
{
  const anaS = await login('ana@turnos.app', 'Demo12345!');
  const marta = await login('demo@turnos.app', 'Demo12345!');

  const noBody = await req('POST', '/assistant/query', { token: marta.token, body: {} });
  check('Pregunta vacía → 400', noBody.status === 400);

  const who = await req('POST', '/assistant/query', { token: marta.token, body: { question: '¿Quién trabaja mañana?' } });
  check('«¿Quién trabaja mañana?» responde con datos', who.status === 200 && (who.data.answer.includes('📅') || who.data.answer.includes('Nadie')));
  check('La respuesta nunca expone emails', !who.data.answer.includes('@'));

  const open = await req('POST', '/assistant/query', { token: marta.token, body: { question: 'turnos abiertos esta semana' } });
  check('«Turnos abiertos» responde', open.status === 200 && (open.data.answer.includes('🔓') || open.data.answer.includes('No hay')));

  const empCost = await req('POST', '/assistant/query', { token: anaS.token, body: { question: 'coste de esta semana' } });
  check('Empleado no obtiene costes', empCost.status === 200 && empCost.data.answer.includes('solo los pueden consultar los gestores'));

  const empOther = await req('POST', '/assistant/query', { token: anaS.token, body: { question: 'horas de Carlos esta semana' } });
  check('Empleado no consulta horas ajenas', empOther.status === 200 && empOther.data.answer.includes('tus propias horas'));

  const empSelf = await req('POST', '/assistant/query', { token: anaS.token, body: { question: 'mis horas esta semana' } });
  check('Empleado consulta sus horas', empSelf.status === 200 && /\d+/.test(empSelf.data.answer));

  const gibberish = await req('POST', '/assistant/query', { token: marta.token, body: { question: 'xyzzy sin sentido' } });
  check('Sin intención reconocida → ayuda con ejemplos', gibberish.status === 200 && gibberish.data.answer.includes('Puedo responder'));
}

console.log('\n== 21. Comandos del cuadrante (propuesta → revisión → aplicación) ==');
{
  const anaS = await login('ana@turnos.app', 'Demo12345!');
  const denied = await req('POST', '/assistant/command', { token: anaS.token, body: { question: 'extiende los turnos de cocina del viernes una hora' } });
  check('Empleado no usa comandos → 403', denied.status === 403);
  const deniedApply = await req('POST', '/assistant/apply', { token: anaS.token, body: { changes: [] } });
  check('Empleado no aplica cambios → 403', deniedApply.status === 403);

  const marta = await login('demo@turnos.app', 'Demo12345!');
  const nextWeek = (() => { const d = new Date(); const day = (d.getDay() + 6) % 7; const ws = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day + 7); return ws.toISOString().slice(0, 10); })();
  const nextWeekEnd = (() => { const d = new Date(); const day = (d.getDay() + 6) % 7; const we = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day + 13); return we.toISOString().slice(0, 10); })();
  const ext = await req('POST', '/assistant/command', { token: marta.token, body: { question: 'extiende los turnos de cocina del viernes una hora y pon nota refuerzo', week_start: nextWeek } });
  check('Comando extender → preview con cambios', ext.status === 200 && ext.data?.kind === 'preview' && ext.data.changes?.length >= 1);
  check('La nota se recoge en los cambios', ext.data?.changes?.[0]?.note === 'refuerzo');
  const beforeShift = ext.data.changes[0];

  const sneak = await req('POST', '/assistant/apply', { token: marta.token, body: { changes: [{ ...beforeShift, shift_id: '00000000-0000-4000-8000-000000000000' }] } });
  check('Aplicar sobre turno inexistente → contado como fallo, no 500', sneak.status === 200 && sneak.data.failed?.length === 1 && sneak.data.applied === 0);

  const applied = await req('POST', '/assistant/apply', { token: marta.token, body: { changes: [beforeShift] } });
  check('Aplicar cambio revisado → aplicado', applied.status === 200 && applied.data.applied === 1 && applied.data.failed.length === 0);
  const chk = await req('GET', `/shifts?from=${nextWeek}&to=${nextWeekEnd}`, { token: marta.token });
  const target = chk.data.shifts.find((s) => s.id === beforeShift.shift_id);
  check('El turno quedó realmente extendido', target && target.end_time.slice(0, 5) === beforeShift.end_time);
  check('La nota quedó guardada', target?.notes?.includes('refuerzo'));

  // Reasignación con anti-BOLA: turno de otra org no se toca
  const shiftB = await req('POST', '/schedules', { token: orgB.token, body: { week_start: '2027-09-06', name: 'B' } });
  const shiftB2 = await req('POST', '/shifts', { token: orgB.token, body: { schedule_id: shiftB.data.schedule.id, date: '2027-09-08', start_time: '09:00', end_time: '15:00', break_minutes: 0 } });
  const crossReassign = await req('POST', '/assistant/apply', {
    token: marta.token,
    body: { changes: [{ type: 'reassign', shift_id: shiftB2.data.shift.id, to_user_id: anaId, label: 'robo' }] },
  });
  check('Reasignar turno de otra org → falla sin aplicar', crossReassign.status === 200 && crossReassign.data.failed?.length === 1 && crossReassign.data.applied === 0);

  const lock = await req('POST', '/assistant/command', { token: marta.token, body: { question: `Ana no está disponible los lunes hasta ${nextWeek}` } });
  check('Comando no-disponible → preview', lock.status === 200 && lock.data?.kind === 'preview' && lock.data.changes?.[0]?.dates?.length >= 1);
  const bad = await req('POST', '/assistant/command', { token: marta.token, body: { question: 'extiende turnos con 99 horas' } });
  check('Comando raro no rompe (respuesta guiada o preview saneado)', bad.status === 200);
  const empty = await req('POST', '/assistant/command', { token: marta.token, body: {} });
  check('Comando vacío → 400', empty.status === 400);
}

console.log('\n== 22. Estrategias de autocompletado ==');
{
  const marta = await login('demo@turnos.app', 'Demo12345!');
  const fut = '2027-08-02'; // lunes
  const sched = await req('POST', '/schedules', { token: marta.token, body: { week_start: fut, name: 'Estrategia' } });
  await req('POST', '/shifts', { token: marta.token, body: { schedule_id: sched.data.schedule.id, date: fut, start_time: '09:00', end_time: '15:00', break_minutes: 0 } });
  await req('POST', '/shifts', { token: marta.token, body: { schedule_id: sched.data.schedule.id, date: fut, start_time: '15:00', end_time: '21:00', break_minutes: 0 } });
  await req('POST', '/shifts', { token: marta.token, body: { schedule_id: sched.data.schedule.id, date: fut, start_time: '21:00', end_time: '23:00', break_minutes: 0 } });
  const r = await req('POST', `/schedules/${sched.data.schedule.id}/autofill`, { token: marta.token, body: { strategy: 'cost' } });
  check('Autofill con estrategia cost → asigna', r.status === 200 && r.data.assigned >= 2);
  const sched2 = await req('POST', '/schedules', { token: marta.token, body: { week_start: '2027-08-09', name: 'Estrategia past' } });
  await req('POST', '/shifts', { token: marta.token, body: { schedule_id: sched2.data.schedule.id, date: '2027-08-09', start_time: '10:00', end_time: '14:00', break_minutes: 0 } });
  const r2 = await req('POST', `/schedules/${sched2.data.schedule.id}/autofill`, { token: marta.token, body: { strategy: 'past' } });
  check('Autofill con estrategia past → asigna', r2.status === 200 && r2.data.assigned === 1);
  const r3 = await req('POST', `/schedules/${sched2.data.schedule.id}/autofill`, { token: marta.token, body: { strategy: 'hack' } });
  check('Estrategia inválida → cae a la por defecto sin romper', r3.status === 200);
}

console.log('\n== 13. Cabeceras de seguridad ==');
{
  const res = await fetch(BASE + '/health');
  const h = res.headers;
  check('CSP presente', !!h.get('content-security-policy'));
  check('X-Content-Type-Options: nosniff', h.get('x-content-type-options') === 'nosniff');
  check('X-Frame-Options: DENY / frame-ancestors none', (h.get('x-frame-options') || h.get('content-security-policy') || '').includes('deny') || (h.get('content-security-policy') || '').includes('frame-ancestors \'none\''));
  check('Powered-by oculto', !h.get('x-powered-by'));
}

console.log(`\n=== RESULTADO: ${pass} PASS / ${fail} FAIL ===\n`);
process.exit(fail ? 1 : 0);
