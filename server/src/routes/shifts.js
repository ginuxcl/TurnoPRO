import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncH, HttpError } from '../middleware/errors.js';
import { fetchScoped } from '../middleware/scope.js';
import { audit } from '../middleware/audit.js';
import { isValidDate, isValidTime, shiftDurationMinutes, addDays, toMinutes, weekStart } from '../utils/time.js';
import { rulesForOrg, checkShiftRules, shiftsAround } from '../utils/rules.js';
import { notify, managerIds } from '../utils/notify.js';

export const shiftsRouter = Router();
shiftsRouter.use(requireAuth);

const timeStr = z.string().refine(isValidTime, 'Hora inválida (HH:MM)');

// Combinaciones de horario más usadas en las últimas 4 semanas (Factorial)
shiftsRouter.get('/frequent', requireRole('manager'), asyncH(async (req, res) => {
  const since = addDays(new Date().toISOString().slice(0, 10), -28);
  const { rows } = await q(
    `SELECT start_time, end_time, break_minutes, count(*)::int AS uses
       FROM shifts WHERE org_id = $1 AND date >= $2
      GROUP BY start_time, end_time, break_minutes
      ORDER BY uses DESC, start_time LIMIT 6`,
    [req.user.org_id, since]
  );
  res.json({ frequent: rows });
}));

const SHIFT_SELECT = `
  SELECT sh.*, u.first_name || ' ' || u.last_name AS user_name, u.color AS user_color,
         d.name AS department_name, d.color AS department_color,
         s.status AS schedule_status, s.week_start AS schedule_week_start
    FROM shifts sh
    JOIN schedules s ON s.id = sh.schedule_id
    LEFT JOIN users u ON u.id = sh.user_id
    LEFT JOIN departments d ON d.id = sh.department_id`;

/**
 * GET /shifts?from&to&department_id&user_id
 * Vista de calendario. Anti-BOLA: solo la propia organización.
 * Employees: únicamente turnos de horarios PUBLICADOS.
 */
shiftsRouter.get('/', asyncH(async (req, res) => {
  const from = isValidDate(req.query.from) ? req.query.from : addDays(weekStartToday(), -7);
  const to = isValidDate(req.query.to) ? req.query.to : addDays(from, 28);
  const conds = ['sh.org_id = $1', 'sh.date BETWEEN $2 AND $3'];
  const params = [req.user.org_id, from, to];
  if (req.user.role === 'employee') conds.push(`s.status = 'published'`);
  if (isValidDate(req.query.user_id)) {
    conds.push(`sh.user_id = $${params.length + 1}`);
    params.push(req.query.user_id);
  } else if (req.query.user_id === 'me') {
    conds.push(`sh.user_id = $${params.length + 1}`);
    params.push(req.user.id);
  } else if (req.query.user_id === 'open') {
    conds.push('sh.user_id IS NULL');
  }
  if (req.query.department_id && /^[0-9a-fA-F-]{36}$/.test(req.query.department_id)) {
    conds.push(`sh.department_id = $${params.length + 1}`);
    params.push(req.query.department_id);
  }
  const { rows } = await q(`${SHIFT_SELECT} WHERE ${conds.join(' AND ')} ORDER BY sh.date, sh.start_time`, params);
  res.json({ shifts: rows.map(withDuration) });
}));

function weekStartToday() {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

function withDuration(sh) {
  return { ...sh, duration_minutes: shiftDurationMinutes(sh.start_time.slice(0, 5), sh.end_time.slice(0, 5), sh.break_minutes) };
}

const shiftSchema = z.object({
  date: z.string().refine(isValidDate, 'Fecha inválida'),
  start_time: timeStr,
  end_time: timeStr,
  break_minutes: z.number().int().min(0).max(720).default(0),
  department_id: z.string().uuid().optional().nullable(),
  user_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(300).optional().nullable(),
});

async function validateRefs(orgId, d) {
  if (d.department_id) await fetchScoped('departments', d.department_id, orgId);
  if (d.user_id) {
    const person = await fetchScoped('users', d.user_id, orgId);
    if (!person.is_active) throw new HttpError(400, 'La persona asignada está desactivada', 'INACTIVE_USER');
    return person;
  }
  return null;
}

// Valida las reglas de la organización; 422 con detalles salvo force=true (gestores)
async function assertRulesOk(orgId, person, candidate, excludeShiftId, force) {
  if (!person) return;
  const rules = await rulesForOrg(orgId);
  const ws = weekStart(candidate.date);
  const around = await shiftsAround(orgId, ws);
  const violations = checkShiftRules({
    rules, user: person, weekStart: ws,
    candidate, existingShifts: around, excludeShiftId,
  });
  if (violations.length && !force) {
    const e = new HttpError(422, 'Incumple las reglas de planificación', 'RULES');
    e.violations = violations;
    throw e;
  }
}

// Solapamiento del mismo empleado en fechas adyacentes (incluye cruces de medianoche)
async function assertNoOverlap(orgId, userId, date, start, end, excludeShiftId) {
  if (!userId) return;
  const { rows } = await q(
    `SELECT id, date, start_time, end_time FROM shifts
      WHERE org_id = $1 AND user_id = $2 AND date BETWEEN $3 AND $4 AND id <> $5`,
    [orgId, userId, addDays(date, -1), addDays(date, 1), excludeShiftId || '00000000-0000-0000-0000-000000000000']
  );
  const s0 = toMinutes(start), e0 = toMinutes(end);
  for (const r of rows) {
    const s1 = toMinutes(r.start_time.slice(0, 5)), e1raw = toMinutes(r.end_time.slice(0, 5));
    const e1 = e1raw <= s1 ? e1raw + 1440 : e1raw;
    const dayDiff = (new Date(`${r.date}T00:00Z`) - new Date(`${date}T00:00Z`)) / 86400000;
    // Convertir ambos a un eje absoluto de minutos
    const aStart = s0, aEnd = e0 <= s0 ? e0 + 1440 : e0;
    const bStart = s1 + dayDiff * 1440, bEnd = e1 + dayDiff * 1440;
    if (aStart < bEnd && bStart < aEnd) {
      throw new HttpError(409, 'La persona ya tiene un turno que se solapa con este horario', 'OVERLAP');
    }
  }
}

shiftsRouter.post('/', requireRole('manager'), asyncH(async (req, res) => {
  const d = shiftSchema.parse(req.body);
  const person = await validateRefs(req.user.org_id, d);
  if (d.start_time === d.end_time) throw new HttpError(400, 'El turno debe tener duración mayor que cero', 'BAD_RANGE');

  // El turno pertenece al horario (borrador o publicado) de su semana
  const ws = weekStartOf(d.date);
  const { rows: srows } = await q(
    `INSERT INTO schedules (org_id, name, week_start, created_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (org_id, week_start) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [req.user.org_id, `Semana del ${ws}`, ws, req.user.id]
  );
  const schedule = srows[0];
  if (schedule.status === 'archived') throw new HttpError(409, 'Esa semana está archivada', 'ARCHIVED');

  await assertNoOverlap(req.user.org_id, d.user_id ?? null, d.date, d.start_time, d.end_time, null);
  await assertRulesOk(req.user.org_id, person, { ...d, user_id: d.user_id ?? null }, null, req.body.force === true);

  const { rows } = await q(
    `INSERT INTO shifts (org_id, schedule_id, date, start_time, end_time, break_minutes, department_id, user_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [req.user.org_id, schedule.id, d.date, d.start_time, d.end_time, d.break_minutes,
     d.department_id ?? null, d.user_id ?? null, d.notes ?? null, req.user.id]
  );
  const created = await q(`${SHIFT_SELECT} WHERE sh.id = $1`, [rows[0].id]);
  audit(req, 'shift.created', 'shift', rows[0].id, { date: d.date, user: d.user_id ?? 'open' });
  res.status(201).json({ shift: withDuration(created.rows[0]) });
}));

function weekStartOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

shiftsRouter.patch('/:id', requireRole('manager'), asyncH(async (req, res) => {
  const shift = await fetchScoped('shifts', req.params.id, req.user.org_id);
  const d = shiftSchema.partial().parse(req.body);

  const merged = {
    date: d.date ?? shift.date,
    start_time: d.start_time ?? shift.start_time.slice(0, 5),
    end_time: d.end_time ?? shift.end_time.slice(0, 5),
    break_minutes: d.break_minutes ?? shift.break_minutes,
    department_id: d.department_id !== undefined ? d.department_id : shift.department_id,
    user_id: d.user_id !== undefined ? d.user_id : shift.user_id,
    notes: d.notes !== undefined ? d.notes : shift.notes,
  };
  await validateRefs(req.user.org_id, merged);
  if (merged.start_time === merged.end_time) throw new HttpError(400, 'El turno debe tener duración mayor que cero', 'BAD_RANGE');

  // Si cambia de semana, reasignar al horario correspondiente (bloqueado si está archivado)
  const targetWs = weekStartOf(merged.date);
  if (targetWs !== shift.schedule_week_start) {
    const { rows: srows } = await q(
      `INSERT INTO schedules (org_id, name, week_start, created_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (org_id, week_start) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [req.user.org_id, `Semana del ${targetWs}`, targetWs, req.user.id]
    );
    if (srows[0].status === 'archived') throw new HttpError(409, 'Esa semana está archivada', 'ARCHIVED');
    merged.schedule_id = srows[0].id;
  }

  await assertNoOverlap(req.user.org_id, merged.user_id, merged.date, merged.start_time, merged.end_time, shift.id);
  const person = merged.user_id ? await fetchScoped('users', merged.user_id, req.user.org_id) : null;
  await assertRulesOk(req.user.org_id, person, { ...merged }, shift.id, req.body.force === true);

  await q(
    `UPDATE shifts SET date=$2, start_time=$3, end_time=$4, break_minutes=$5,
       department_id=$6, user_id=$7, notes=$8, schedule_id=COALESCE($9, schedule_id), updated_at=now()
      WHERE id = $1 AND org_id = $10`,
    [shift.id, merged.date, merged.start_time, merged.end_time, merged.break_minutes,
     merged.department_id ?? null, merged.user_id ?? null, merged.notes ?? null,
     merged.schedule_id ?? null, req.user.org_id]
  );
  // Si se desasigna una persona, cancelar sus reclamaciones pendientes sobre ese turno
  if (merged.user_id === null) {
    await q(`UPDATE shift_claims SET status = 'cancelled', reviewed_at = now()
              WHERE shift_id = $1 AND status = 'pending'`, [shift.id]);
  }
  const updated = await q(`${SHIFT_SELECT} WHERE sh.id = $1`, [shift.id]);
  audit(req, 'shift.updated', 'shift', shift.id, { user: merged.user_id ?? 'open' });
  res.json({ shift: withDuration(updated.rows[0]) });
}));

shiftsRouter.delete('/:id', requireRole('manager'), asyncH(async (req, res) => {
  const shift = await fetchScoped('shifts', req.params.id, req.user.org_id);
  await q('DELETE FROM shifts WHERE id = $1 AND org_id = $2', [shift.id, req.user.org_id]);
  audit(req, 'shift.deleted', 'shift', shift.id, { date: shift.date });
  res.json({ ok: true });
}));

// ---------- Reclamar turno abierto ----------
shiftsRouter.post('/:id/claim', asyncH(async (req, res) => {
  const shift = await fetchScoped('shifts', req.params.id, req.user.org_id);
  const sched = await fetchScoped('schedules', shift.schedule_id, req.user.org_id);
  if (sched.status !== 'published') throw new HttpError(400, 'El horario no está publicado', 'NOT_PUBLISHED');
  if (shift.user_id) {
    if (shift.user_id === req.user.id) throw new HttpError(409, 'Ya tienes este turno asignado', 'MINE');
    throw new HttpError(409, 'Este turno ya está asignado a otra persona', 'TAKEN');
  }
  // Baja aprobada ese día → no reclamar
  const leave = await q(
    `SELECT 1 FROM leave_requests WHERE user_id = $1 AND org_id = $2 AND status = 'approved'
       AND $3 BETWEEN start_date AND end_date`,
    [req.user.id, req.user.org_id, shift.date]
  );
  if (leave.rows[0]) throw new HttpError(409, 'Tienes una ausencia aprobada para ese día', 'ON_LEAVE');

  try {
    const { rows } = await q(
      `INSERT INTO shift_claims (org_id, shift_id, user_id) VALUES ($1,$2,$3) RETURNING *`,
      [req.user.org_id, shift.id, req.user.id]
    );
    audit(req, 'claim.created', 'shift_claim', rows[0].id, { shift: shift.id });
    res.status(201).json({ claim: rows[0] });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Ya has solicitado este turno', 'DUP');
    throw e;
  }
}));
