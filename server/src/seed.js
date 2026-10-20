// Datos demo: organización "La Terraza Gastrobar" con personal, departamentos,
// plantillas, horarios (semana actual publicada + próxima en borrador),
// solicitudes de ausencia y reclamaciones. Idempotente.
import { pool, q } from './db.js';
import { hashPassword } from './utils/passwords.js';
import { weekStart, addDays, todayStr } from './utils/time.js';

const DEMO_EMAIL = 'demo@turnos.app';
const STAFF_EMAIL = 'ana@turnos.app';
const PASSWORD = 'Demo12345!';

async function main() {
  const existing = await q('SELECT id FROM organizations WHERE slug = $1', ['la-terraza-demo']);
  if (existing.rows[0]) {
    console.log('[seed] La organización demo ya existe. Nada que hacer.');
    await pool.end();
    return;
  }

  const org = await q(
    `INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING *`,
    ['La Terraza Gastrobar', 'la-terraza-demo']
  );
  const orgId = org.rows[0].id;

  const deps = {};
  for (const [name, color] of [['Cocina', '#f97316'], ['Sala', '#0ea5e9'], ['Barra', '#8b5cf6']]) {
    const r = await q('INSERT INTO departments (org_id, name, color) VALUES ($1,$2,$3) RETURNING *', [orgId, name, color]);
    deps[name] = r.rows[0];
  }

  const hash = await hashPassword(PASSWORD);

  const people = [
    [DEMO_EMAIL, 'Marta', 'Fernández', 'owner', 'Gerente', null, '#6366f1', 40, 24.0],
    ['javier@turnos.app', 'Javier', 'Ortega', 'manager', 'Jefe de sala', deps['Sala'].id, '#0ea5e9', 40, 18.5],
    [STAFF_EMAIL, 'Ana', 'Ruiz', 'employee', 'Cocinera', deps['Cocina'].id, '#f97316', 38, 15.4],
    ['carlos@turnos.app', 'Carlos', 'Molina', 'employee', 'Camarero', deps['Sala'].id, '#14b8a6', 40, 13.8],
    ['lucia@turnos.app', 'Lucía', 'Navarro', 'employee', 'Bartender', deps['Barra'].id, '#8b5cf6', 30, 16.2],
    ['pablo@turnos.app', 'Pablo', 'Serrano', 'employee', 'Ayudante de cocina', deps['Cocina'].id, '#f59e0b', 20, 12.5],
    ['elena@turnos.app', 'Elena', 'Castro', 'employee', 'Camarera', deps['Sala'].id, '#ec4899', 40, 13.2],
  ];
  const users = {};
  for (const [email, fn, ln, role, position, depId, color, hours, rate] of people) {
    const r = await q(
      `INSERT INTO users (org_id, email, password_hash, first_name, last_name, role, position, department_id, color, weekly_hours, hourly_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [orgId, email, hash, fn, ln, role, position, depId, color, hours, rate]
    );
    users[fn] = r.rows[0];
  }

  // Plantillas de turno
  const templates = [
    ['Mañana', '10:00', '17:00', 30, '#f59e0b', 'Cocina'],
    ['Tarde', '17:00', '00:00', 45, '#6366f1', 'Sala'],
    ['Cierre', '19:00', '01:00', 30, '#8b5cf6', 'Barra'],
    ['Partido (M+T)', '12:00', '22:00', 60, '#14b8a6', 'Sala'],
  ];
  for (const [name, st, et, brk, color, dep] of templates) {
    await q(
      `INSERT INTO shift_templates (org_id, name, start_time, end_time, break_minutes, color, department_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [orgId, name, st, et, brk, color, deps[dep].id]
    );
  }

  // Disponibilidad de ejemplo
  for (const [fn, wd, st, et] of [
    ['Ana', [1, 1, 1, 1, 1, 1, 0], '08:00', '16:00'],
    ['Lucía', [0, 1, 1, 1, 1, 1, 1], '16:00', '02:00'],
    ['Pablo', [0, 0, 1, 1, 1, 1, 1], '09:00', '17:00'],
  ]) {
    await q(
      `INSERT INTO availability (org_id, user_id, weekdays, start_time, end_time)
       VALUES ($1,$2,$3,$4,$5)`,
      [orgId, users[fn].id, JSON.stringify(wd), st, et]
    );
  }

  // Horarios: semana actual (publicada) y próxima (borrador)
  const ws = weekStart(todayStr());
  const schedules = {};
  for (const [weekOffset, status] of [[0, 'published'], [7, 'draft']]) {
    const w = addDays(ws, weekOffset);
    const r = await q(
      `INSERT INTO schedules (org_id, name, week_start, status, published_at, created_by)
       VALUES ($1,$2,$3,$4, $5, $6) RETURNING *`,
      [orgId, `Semana del ${w}`, w, status, status === 'published' ? new Date() : null, users['Marta'].id]
    );
    schedules[weekOffset] = r.rows[0];
  }

  // Turnos de la semana actual [lun..dom]: [día, inicio, fin, pausa, dep, persona]
  const currentWeekShifts = [
    [0, '10:00', '17:00', 30, 'Cocina', 'Ana'], [0, '17:00', '00:00', 45, 'Sala', 'Carlos'],
    [0, '17:00', '00:30', 45, 'Barra', 'Lucía'], [0, '10:00', '16:00', 0, 'Sala', 'Elena'],
    [1, '10:00', '17:00', 30, 'Cocina', 'Pablo'], [1, '17:00', '00:00', 45, 'Sala', 'Carlos'],
    [1, '18:00', '00:30', 30, 'Barra', 'Lucía'],
    [2, '10:00', '17:00', 30, 'Cocina', 'Ana'], [2, '17:00', '00:00', 45, 'Sala', 'Elena'],
    [2, '17:00', '00:30', 45, 'Barra', 'Lucía'], [2, '19:00', '01:00', 30, 'Cocina', 'Pablo'],
    [3, '10:00', '17:00', 30, 'Cocina', 'Ana'], [3, '17:00', '00:00', 45, 'Sala', 'Carlos'],
    [3, '18:00', '00:30', 30, 'Barra', 'Lucía'],
    [4, '11:00', '18:00', 30, 'Cocina', 'Ana'], [4, '17:00', '00:00', 45, 'Sala', 'Elena'],
    [4, '18:00', '01:00', 45, 'Barra', 'Lucía'], [4, '12:00', '22:00', 60, 'Sala', 'Javier'],
    [5, '11:00', '18:00', 30, 'Cocina', 'Pablo'], [5, '12:00', '00:00', 60, 'Sala', 'Carlos'],
    [5, '12:00', '00:30', 60, 'Barra', 'Lucía'], [5, '11:00', '17:00', 0, 'Sala', 'Elena'],
    [5, null, null, 0, 'Cocina', null],
    [6, '12:00', '23:00', 60, 'Sala', 'Javier'], [6, '12:00', '23:00', 60, 'Barra', 'Lucía'],
    [6, '12:00', '22:00', 30, 'Cocina', 'Ana'], [6, null, null, 0, 'Sala', null],
  ];
  for (const [day, st, et, brk, dep, person] of currentWeekShifts) {
    const date = addDays(ws, day);
    // Turnos abiertos (sin persona): franja fija del servicio
    const [start, end] = st ? [st, et] : ['13:00', '23:00'];
    await q(
      `INSERT INTO shifts (org_id, schedule_id, date, start_time, end_time, break_minutes, department_id, user_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [orgId, schedules[0].id, date, start, end, brk, deps[dep].id, person ? users[person].id : null, users['Marta'].id]
    );
  }

  // Próxima semana (borrador): rotación distinta
  const nextWeekShifts = [
    [0, '10:00', '17:00', 30, 'Cocina', 'Pablo'], [0, '17:00', '00:00', 45, 'Sala', 'Elena'],
    [0, '17:00', '00:30', 45, 'Barra', 'Lucía'],
    [1, '10:00', '17:00', 30, 'Cocina', 'Ana'], [1, '17:00', '00:00', 45, 'Sala', 'Carlos'],
    [1, '18:00', '00:30', 30, 'Barra', 'Lucía'],
    [2, '10:00', '17:00', 30, 'Cocina', 'Ana'], [2, '17:00', '00:00', 45, 'Sala', 'Elena'],
    [3, '10:00', '17:00', 30, 'Cocina', 'Pablo'], [3, '17:00', '00:00', 45, 'Sala', 'Carlos'],
    [4, '11:00', '18:00', 30, 'Cocina', 'Ana'], [4, '17:00', '00:00', 45, 'Sala', 'Elena'],
    [4, '12:00', '22:00', 60, 'Sala', 'Javier'],
    [5, '11:00', '18:00', 30, 'Cocina', 'Pablo'], [5, '12:00', '00:00', 60, 'Sala', 'Carlos'],
    [5, '12:00', '00:30', 60, 'Barra', 'Lucía'],
    [6, '12:00', '23:00', 60, 'Sala', 'Javier'], [6, '12:00', '22:00', 30, 'Cocina', 'Ana'],
  ];
  for (const [day, st, et, brk, dep, person] of nextWeekShifts) {
    await q(
      `INSERT INTO shifts (org_id, schedule_id, date, start_time, end_time, break_minutes, department_id, user_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [orgId, schedules[7].id, addDays(ws, 7 + day), st, et, brk, deps[dep].id, users[person].id, users['Marta'].id]
    );
  }

  // Ausencias: una aprobada (pasado-futuro corto) y dos pendientes
  await q(
    `INSERT INTO leave_requests (org_id, user_id, type, start_date, end_date, reason, status, reviewed_by, reviewed_at)
     VALUES ($1,$2,'vacation', $3, $4, 'Vacaciones familiares', 'approved', $5, now())`,
    [orgId, users['Elena'].id, addDays(ws, -14), addDays(ws, -10), users['Marta'].id]
  );
  await q(
    `INSERT INTO leave_requests (org_id, user_id, type, start_date, end_date, reason)
     VALUES ($1,$2,'vacation', $3, $4, 'Puente de noviembre'),
            ($1,$5,'personal', $6, $6, 'Médico')`,
    [orgId, users['Carlos'].id, addDays(ws, 10), addDays(ws, 14), users['Pablo'].id, addDays(ws, 3)]
  );

  // Una reclamación pendiente sobre el turno abierto del sábado
  const openShift = await q(
    `SELECT sh.id FROM shifts sh WHERE sh.schedule_id = $1 AND sh.user_id IS NULL AND sh.department_id = $2 LIMIT 1`,
    [schedules[0].id, deps['Cocina'].id]
  );
  if (openShift.rows[0]) {
    await q(
      `INSERT INTO shift_claims (org_id, shift_id, user_id) VALUES ($1,$2,$3)`,
      [orgId, openShift.rows[0].id, users['Pablo'].id]
    );
  }

  // Un cambio de turno pendiente: Ana ofrece su último turno a Carlos + notificaciones demo
  const anaShift = await q(
    `SELECT sh.id, sh.date, sh.start_time, sh.end_time FROM shifts sh
      WHERE sh.schedule_id = $1 AND sh.user_id = $2 ORDER BY sh.date DESC LIMIT 1`,
    [schedules[0].id, users['Ana'].id]
  );
  if (anaShift.rows[0]) {
    const sh = anaShift.rows[0];
    await q(
      `INSERT INTO swap_requests (org_id, shift_id, from_user_id, to_user_id) VALUES ($1,$2,$3,$4)`,
      [orgId, sh.id, users['Ana'].id, users['Carlos'].id]
    );
    await q(
      `INSERT INTO notifications (org_id, user_id, type, title, body, link) VALUES
        ($1, $2, 'swap', 'Ana Ruiz quiere cederte un turno', $3, '/app/solicitudes?tab=swaps'),
        ($1, $4, 'schedule', '🗓 Nuevo horario publicado', 'Ya puedes ver tus turnos en la sección Mis turnos', '/app/mis-turnos'),
        ($1, $2, 'schedule', '🗓 Nuevo horario publicado', 'Ya puedes ver tus turnos en la sección Mis turnos', '/app/mis-turnos')`,
      [orgId, users['Carlos'].id, `${sh.date} · ${sh.start_time.slice(0, 5)}–${sh.end_time.slice(0, 5)}`, users['Ana'].id]
    );
  }

  // Festivos de la organización (se pintan en el calendario)
  const year = Number(ws.slice(0, 4));
  for (const [date, name] of [
    [`${year}-11-01`, 'Todos los Santos'], [`${year}-12-06`, 'Constitución'],
    [`${year}-12-08`, 'Inmaculada'], [`${year}-12-25`, 'Navidad'],
    [`${year + 1}-01-01`, 'Año Nuevo'], [`${year + 1}-01-06`, 'Reyes'],
  ]) {
    await q(`INSERT INTO holidays (org_id, date, name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [orgId, date, name]);
  }

  // Patrón de semana de ejemplo (rotación cocina 5x2 + refuerzo finde)
  await q(
    `INSERT INTO week_patterns (org_id, name, days) VALUES ($1,$2,$3)`,
    [orgId, 'Semana Cocina 5x2', JSON.stringify([
      [{ name: 'Mañana cocina', start_time: '10:00', end_time: '17:00', break_minutes: 30 }],
      [{ name: 'Mañana cocina', start_time: '10:00', end_time: '17:00', break_minutes: 30 }],
      [{ name: 'Mañana cocina', start_time: '10:00', end_time: '17:00', break_minutes: 30 }],
      [{ name: 'Mañana cocina', start_time: '10:00', end_time: '17:00', break_minutes: 30 }],
      [{ name: 'Viernes largo', start_time: '11:00', end_time: '19:00', break_minutes: 30 }],
      [],
      [],
    ])]
  );
  await q(
    `INSERT INTO week_patterns (org_id, name, days) VALUES ($1,$2,$3)`,
    [orgId, 'Finde reforzado', JSON.stringify([
      [],
      [],
      [],
      [],
      [],
      [
        { name: 'Sala mediodía', start_time: '12:00', end_time: '00:00', break_minutes: 60 },
        { name: 'Barra mediodía', start_time: '12:00', end_time: '00:30', break_minutes: 60 },
      ],
      [
        { name: 'Sala mediodía', start_time: '12:00', end_time: '23:00', break_minutes: 60 },
        { name: 'Barra mediodía', start_time: '12:00', end_time: '23:00', break_minutes: 60 },
      ],
    ])]
  );

  // Fichajes realistas de hoy (si hay turnos hoy): uno ya cerrado y otro en curso
  const today = todayStr();
  const todayShifts = (await q(
    `SELECT sh.*, u.first_name FROM shifts sh JOIN users u ON u.id = sh.user_id
      WHERE sh.org_id = $1 AND sh.date = $2 ORDER BY sh.start_time`,
    [orgId, today]
  )).rows;
  for (const [i, s] of todayShifts.slice(0, 2).entries()) {
    const inMin = Number(s.start_time.slice(0, 2)) * 60 + Number(s.start_time.slice(3, 5)) + (i === 0 ? 4 : -6);
    const inAt = new Date(`${today}T00:00:00`);
    inAt.setMinutes(inMin);
    if (i === 0) {
      const outAt = new Date(inAt.getTime() + (330 + 17) * 60000); // 5h47m trabajadas
      await q(
        `INSERT INTO time_entries (org_id, user_id, work_date, clock_in, clock_out) VALUES ($1,$2,$3,$4,$5)`,
        [orgId, s.user_id, today, inAt, outAt]
      );
    } else {
      await q(
        `INSERT INTO time_entries (org_id, user_id, work_date, clock_in) VALUES ($1,$2,$3,$4)`,
        [orgId, s.user_id, today, inAt]
      );
    }
  }

  // Preferencia demo: Lucía bloquea un día de la semana próxima
  await q(
    `INSERT INTO preferences (user_id, org_id, blocked_dates) VALUES ($1,$2,$3)`,
    [users['Lucía'].id, orgId, JSON.stringify([addDays(ws, 9)])]
  );

  console.log('[seed] Demo lista:');
  console.log('        Gestor   → demo@turnos.app / Demo12345!  (Marta, owner)');
  console.log('        Empleada → ana@turnos.app / Demo12345!   (Ana, employee)');
  await pool.end();
}

main().catch((e) => {
  console.error('[seed] error:', e);
  process.exit(1);
});
