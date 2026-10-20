import { Router } from 'express';
import { z } from 'zod';
import { q, withTx } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncH, HttpError } from '../middleware/errors.js';
import { fetchScoped } from '../middleware/scope.js';
import { audit } from '../middleware/audit.js';
import { isValidDate, addDays, weekStart, todayStr, shiftDurationMinutes } from '../utils/time.js';
import { rulesForOrg, checkShiftRules, shiftsAround } from '../utils/rules.js';
import { notify, activeUserIds } from '../utils/notify.js';

export const schedulesRouter = Router();
schedulesRouter.use(requireAuth);

// ---------- Listar horarios por rango ----------
schedulesRouter.get('/', asyncH(async (req, res) => {
  const from = isValidDate(req.query.from) ? req.query.from : addDays(weekStart(todayStr()), -28);
  const to = isValidDate(req.query.to) ? req.query.to : addDays(from, 84);
  const employeeFilter = req.user.role === 'employee' ? `AND status = 'published'` : '';
  const { rows } = await q(
    `SELECT s.*,
       (SELECT count(*) FROM shifts sh WHERE sh.schedule_id = s.id) AS total_shifts,
       (SELECT count(*) FROM shifts sh WHERE sh.schedule_id = s.id AND sh.user_id IS NOT NULL) AS assigned_shifts
      FROM schedules s WHERE s.org_id = $1 AND s.week_start BETWEEN $2 AND $3 ${employeeFilter}
      ORDER BY s.week_start`,
    [req.user.org_id, from, to]
  );
  res.json({ schedules: rows });
}));

// ---------- Crear horario para una semana (idempotente) ----------
schedulesRouter.post('/', requireRole('manager'), asyncH(async (req, res) => {
  const body = z.object({ week_start: z.string().refine(isValidDate, 'Fecha inválida') }).parse(req.body);
  const ws = weekStart(body.week_start);

  const existing = await q('SELECT * FROM schedules WHERE org_id = $1 AND week_start = $2', [req.user.org_id, ws]);
  if (existing.rows[0]) {
    return res.json({ schedule: existing.rows[0], existed: true });
  }
  const { rows } = await q(
    `INSERT INTO schedules (org_id, name, week_start, created_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.user.org_id, `Semana del ${ws}`, ws, req.user.id]
  );
  audit(req, 'schedule.created', 'schedule', rows[0].id, { week_start: ws });
  res.status(201).json({ schedule: rows[0] });
}));

// ---------- Detalle con turnos ----------
schedulesRouter.get('/:id', asyncH(async (req, res) => {
  const schedule = await fetchScoped('schedules', req.params.id, req.user.org_id);
  if (req.user.role === 'employee' && schedule.status !== 'published') {
    throw new HttpError(404, 'Recurso no encontrado', 'NOT_FOUND');
  }
  const shifts = await q(
    `SELECT sh.*, u.first_name || ' ' || u.last_name AS user_name, u.color AS user_color,
            d.name AS department_name, d.color AS department_color
       FROM shifts sh
       LEFT JOIN users u ON u.id = sh.user_id
       LEFT JOIN departments d ON d.id = sh.department_id
      WHERE sh.schedule_id = $1 AND sh.org_id = $2
      ORDER BY sh.date, sh.start_time`,
    [schedule.id, req.user.org_id]
  );
  res.json({ schedule, shifts: shifts.rows });
}));

// ---------- Cambiar estado (publicar / volver a borrador / archivar) ----------
schedulesRouter.post('/:id/status', requireRole('manager'), asyncH(async (req, res) => {
  const schedule = await fetchScoped('schedules', req.params.id, req.user.org_id);
  const { status } = z.object({ status: z.enum(['draft', 'published', 'archived']) }).parse(req.body);

  if (status === 'published' && schedule.status === 'published') {
    throw new HttpError(409, 'Este horario ya está publicado', 'ALREADY');
  }
  if (status === 'published') {
    const empty = await q('SELECT 1 FROM shifts WHERE schedule_id = $1 LIMIT 1', [schedule.id]);
    if (!empty.rows[0]) throw new HttpError(400, 'No puedes publicar un horario sin turnos', 'EMPTY');
  }

  await q(
    `UPDATE schedules SET status = $2, published_at = CASE WHEN $2 = 'published' THEN now() ELSE NULL END
      WHERE id = $1 AND org_id = $3`,
    [schedule.id, status, req.user.org_id]
  );

  // Avisar (en la respuesta) de turnos asignados a personas con baja aprobada ese día
  let warnings = [];
  if (status === 'published') {
    const conflicts = await q(
      `SELECT sh.id, sh.date, u.first_name || ' ' || u.last_name AS person, l.type
         FROM shifts sh
         JOIN users u ON u.id = sh.user_id
         JOIN leave_requests l ON l.user_id = u.id AND l.org_id = sh.org_id
              AND l.status = 'approved' AND sh.date BETWEEN l.start_date AND l.end_date
        WHERE sh.schedule_id = $1`,
      [schedule.id]
    );
    warnings = conflicts.rows.map((c) => ({ kind: 'leave', ...c }));

    // Cumplimiento de reglas por persona
    const rules = await rulesForOrg(req.user.org_id);
    const around = await shiftsAround(req.user.org_id, schedule.week_start, 3);
    const assigned = await q(
      `SELECT sh.*, u.first_name, u.last_name, u.weekly_hours
         FROM shifts sh JOIN users u ON u.id = sh.user_id
        WHERE sh.schedule_id = $1`,
      [schedule.id]
    );
    const byUser = new Map();
    for (const sh of assigned.rows) {
      if (!byUser.has(sh.user_id)) byUser.set(sh.user_id, []);
      byUser.get(sh.user_id).push(sh);
    }
    for (const [userId, list] of byUser) {
      const person = list[0];
      for (const sh of list) {
        const violations = checkShiftRules({
          rules,
          user: { first_name: person.first_name, weekly_hours: person.weekly_hours },
          weekStart: schedule.week_start,
          candidate: { ...sh, user_id: userId },
          existingShifts: [...around, ...list.filter((x) => x.id !== sh.id)],
          excludeShiftId: sh.id,
        });
        warnings.push(...violations.map((msg) => ({ kind: 'rule', date: sh.date, person: `${person.first_name} ${person.last_name}`, message: msg })));
      }
    }
  }
  audit(req, `schedule.${status}`, 'schedule', schedule.id, { week_start: schedule.week_start });
  if (status === 'published') {
    await notify(req.user.org_id, await activeUserIds(req.user.org_id), 'schedule',
      `🗓 Nuevo horario publicado: semana del ${schedule.week_start}`,
      'Ya puedes ver tus turnos en la sección Mis turnos', '/app/mis-turnos');
  }
  res.json({ ok: true, status, warnings });
}));

// ---------- Autocompletar turnos abiertos de la semana ----------
// Voraz: cada turno abierto va a la persona activa elegible con menor carga
// relativa a su contrato, respetando ausencias, disponibilidad y reglas.
schedulesRouter.post('/:id/autofill', requireRole('manager'), asyncH(async (req, res) => {
  const schedule = await fetchScoped('schedules', req.params.id, req.user.org_id);
  if (schedule.status === 'archived') throw new HttpError(409, 'Esa semana está archivada', 'ARCHIVED');

  // Prioridades de autocompletado (estilo Deputy): equidad de carga, menor coste o repetir el patrón reciente
  const strategy = ['balanced', 'cost', 'past'].includes(req.body?.strategy) ? req.body.strategy : 'balanced';

  const rules = await rulesForOrg(req.user.org_id);
  const open = (await q(
    'SELECT * FROM shifts WHERE schedule_id = $1 AND user_id IS NULL ORDER BY date, start_time',
    [schedule.id]
  )).rows;
  const total = open.length;
  if (!total) return res.json({ assigned: 0, still_open: 0, by_person: {} });

  const staff = (await q(
    'SELECT id, first_name, last_name, weekly_hours, hourly_rate FROM users WHERE org_id = $1 AND is_active',
    [req.user.org_id]
  )).rows;
  const ws = schedule.week_start;
  const rateOf = (p) => (p.hourly_rate == null ? Number.MAX_SAFE_INTEGER : Number(p.hourly_rate));
  let pastScore = null;
  if (strategy === 'past') {
    const hist = (await q(
      'SELECT user_id, date, start_time FROM shifts WHERE org_id = $1 AND user_id IS NOT NULL AND date BETWEEN $2 AND $3',
      [req.user.org_id, addDays(ws, -28), addDays(ws, -1)]
    )).rows;
    pastScore = new Map();
    for (const h of hist) {
      const dow = new Date(`${h.date}T12:00:00`).getDay();
      const k = `${h.user_id}|${dow}|${h.start_time.slice(0, 5)}`;
      pastScore.set(k, (pastScore.get(k) || 0) + 1);
    }
  }
  const dur = (x) => shiftDurationMinutes(x.start_time.slice(0, 5), x.end_time.slice(0, 5), x.break_minutes);

  const assigned = (await shiftsAround(req.user.org_id, ws, 3)).map((x) => ({ ...x }));
  const leaveRows = (await q(
    "SELECT user_id, start_date, end_date FROM leave_requests WHERE org_id = $1 AND status = 'approved'",
    [req.user.org_id]
  )).rows;
  const onLeave = (userId, date) =>
    leaveRows.some((l) => l.user_id === userId && date >= l.start_date && date <= l.end_date);
  const prefRows = (await q('SELECT user_id, blocked_dates FROM preferences WHERE org_id = $1', [req.user.org_id])).rows;
  const blockedMap = new Map(prefRows.map((r) => [r.user_id, r.blocked_dates || []]));
  const loadOf = (userId) => assigned.filter((x) => x.user_id === userId).reduce((a, x) => a + dur(x), 0);
  const countOf = (userId) => assigned.filter((x) => x.user_id === userId).length;

  let stillOpen = 0;
  const byPerson = {};

  for (const shift of open) {
    const candidates = [];
    for (const p of staff) {
      if (onLeave(p.id, shift.date)) continue;
      if ((blockedMap.get(p.id) || []).includes(shift.date)) continue; // día bloqueado por preferencia
      const v = checkShiftRules({
        rules, user: p, weekStart: ws,
        candidate: { ...shift, user_id: p.id },
        existingShifts: assigned,
      });
      if (v.length) continue;
      const capH = rules.max_weekly_hours ?? p.weekly_hours ?? 40;
      const load = loadOf(p.id) + dur(shift);
      const dow = new Date(`${shift.date}T12:00:00`).getDay();
      candidates.push({
        p, loadRatio: load / (capH * 60), count: countOf(p.id),
        rate: rateOf(p),
        past: pastScore ? (pastScore.get(`${p.id}|${dow}|${shift.start_time.slice(0, 5)}`) || 0) : 0,
      });
    }
    if (!candidates.length) { stillOpen++; continue; }
    if (strategy === 'cost') {
      candidates.sort((a, b) => a.rate - b.rate || a.loadRatio - b.loadRatio || a.p.id.localeCompare(b.p.id));
    } else if (strategy === 'past') {
      candidates.sort((a, b) => b.past - a.past || a.loadRatio - b.loadRatio || a.p.id.localeCompare(b.p.id));
    } else {
      candidates.sort((a, b) => a.loadRatio - b.loadRatio || a.count - b.count || a.p.id.localeCompare(b.p.id));
    }
    const chosen = candidates[0].p;
    assigned.push({ ...shift, user_id: chosen.id });
    const key = chosen.first_name + ' ' + chosen.last_name;
    byPerson[key] = (byPerson[key] || 0) + 1;
    await q('UPDATE shifts SET user_id = $2, updated_at = now() WHERE id = $1', [shift.id, chosen.id]);
  }

  const assignedTotal = total - stillOpen;
  audit(req, 'schedule.autofilled', 'schedule', schedule.id, { assigned: assignedTotal, still_open: stillOpen });
  res.json({ assigned: assignedTotal, still_open: stillOpen, by_person: byPerson });
}));

// ---------- Copiar a la semana siguiente ----------
schedulesRouter.post('/:id/copy-next', requireRole('manager'), asyncH(async (req, res) => {
  const schedule = await fetchScoped('schedules', req.params.id, req.user.org_id);
  const nextWs = addDays(schedule.week_start, 7);

  const result = await withTx(async (tx) => {
    const dup = await tx.query('SELECT id FROM schedules WHERE org_id = $1 AND week_start = $2 FOR UPDATE',
      [req.user.org_id, nextWs]);
    if (dup.rows[0]) throw new HttpError(409, 'Ya existe un horario para la semana siguiente', 'DUP');

    const created = await tx.query(
      `INSERT INTO schedules (org_id, name, week_start, created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.org_id, `Semana del ${nextWs}`, nextWs, req.user.id]
    );
    const newId = created.rows[0].id;
    await tx.query(
      `INSERT INTO shifts (org_id, schedule_id, date, start_time, end_time, break_minutes, department_id, user_id, notes, created_by)
       SELECT org_id, $2, date + 7, start_time, end_time, break_minutes, department_id, user_id, notes, $3
         FROM shifts WHERE schedule_id = $1`,
      [schedule.id, newId, req.user.id]
    );
    const count = await tx.query('SELECT count(*) FROM shifts WHERE schedule_id = $1', [newId]);
    return { schedule: created.rows[0], copied: Number(count.rows[0].count) };
  });

  audit(req, 'schedule.copied', 'schedule', result.schedule.id, { from: schedule.id, shifts: result.copied });
  res.status(201).json(result);
}));
