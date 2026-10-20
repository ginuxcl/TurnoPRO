import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncH, HttpError } from '../middleware/errors.js';
import { fetchScoped } from '../middleware/scope.js';
import { isValidDate, isValidTime, weekStart, addDays } from '../utils/time.js';
import { checkShiftRules, shiftsAround } from '../utils/rules.js';
import { audit } from '../middleware/audit.js';
import { notify } from '../utils/notify.js';

export const patternsRouter = Router();
patternsRouter.use(requireAuth);

const slot = z.object({
  name: z.string().trim().max(60).optional().nullable(),
  start_time: z.string().refine(isValidTime, 'Hora inválida'),
  end_time: z.string().refine(isValidTime, 'Hora inválida'),
  break_minutes: z.number().int().min(0).max(480).default(0),
  user_id: z.string().uuid().optional().nullable(),
});
const patternSchema = z.object({
  name: z.string().trim().min(1).max(60),
  days: z.array(z.array(slot)).length(7),
});

// Turnos abiertos por defecto; validación del rango horario
function assertSlots(d) {
  for (const [di, day] of d.days.entries()) {
    for (const s of day) {
      if (s.start_time >= s.end_time && s.end_time !== '00:00') {
        throw new HttpError(400, `Día ${di + 1}: la hora de inicio debe ser anterior a la de fin (los turnos que acaban a las 00:00 sí se permiten)`, 'BAD_RANGE');
      }
    }
  }
}

patternsRouter.get('/', requireRole('manager'), asyncH(async (req, res) => {
  const { rows } = await q(`SELECT * FROM week_patterns WHERE org_id = $1 ORDER BY created_at DESC`, [req.user.org_id]);
  res.json({ patterns: rows });
}));

patternsRouter.post('/', requireRole('manager'), asyncH(async (req, res) => {
  const d = patternSchema.parse(req.body);
  assertSlots(d);
  const { rows } = await q(
    `INSERT INTO week_patterns (org_id, name, days) VALUES ($1,$2,$3) RETURNING *`,
    [req.user.org_id, d.name, JSON.stringify(d.days)]
  );
  audit(req, 'pattern.created', 'week_pattern', rows[0].id, { name: d.name });
  res.status(201).json({ pattern: rows[0] });
}));

patternsRouter.patch('/:id', requireRole('manager'), asyncH(async (req, res) => {
  const existing = await fetchScoped('week_patterns', req.params.id, req.user.org_id);
  const d = patternSchema.parse(req.body);
  assertSlots(d);
  const { rows } = await q(
    `UPDATE week_patterns SET name = $2, days = $3 WHERE id = $1 RETURNING *`,
    [existing.id, d.name, JSON.stringify(d.days)]
  );
  audit(req, 'pattern.updated', 'week_pattern', existing.id);
  res.json({ pattern: rows[0] });
}));

patternsRouter.delete('/:id', requireRole('manager'), asyncH(async (req, res) => {
  const existing = await fetchScoped('week_patterns', req.params.id, req.user.org_id);
  await q(`DELETE FROM week_patterns WHERE id = $1`, [existing.id]);
  audit(req, 'pattern.deleted', 'week_pattern', existing.id);
  res.json({ ok: true });
}));

// Aplicar patrón a una semana → crea los turnos en un horario borrador
patternsRouter.post('/:id/apply', requireRole('manager'), asyncH(async (req, res) => {
  const pattern = await fetchScoped('week_patterns', req.params.id, req.user.org_id);
  const body = z.object({
    week_start: z.string().refine(isValidDate, 'Fecha inválida'),
    force: z.boolean().optional(),
  }).parse(req.body);

  // Validar que los user_id del patrón pertenecen a la org (anti-BOLA)
  const days = pattern.days.map((day) => day.map((s) => ({
    ...s,
    user_id: s.user_id || null,
  })));
  const wanted = [...new Set(days.flat().map((s) => s.user_id).filter(Boolean))];
  if (wanted.length) {
    const chk = await q(
      `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND org_id = $2`,
      [wanted, req.user.org_id]
    );
    const valid = new Set(chk.rows.map((r) => r.id));
    for (const day of days) for (const s of day) if (s.user_id && !valid.has(s.user_id)) s.user_id = null;
  }

  // Buscar o crear el horario de esa semana (borrador)
  const ws = weekStart(body.week_start);
  let sched = (await q(
    `SELECT * FROM schedules WHERE org_id = $1 AND week_start = $2`,
    [req.user.org_id, ws]
  )).rows[0];
  if (!sched) {
    sched = (await q(
      `INSERT INTO schedules (org_id, week_start, name, status) VALUES ($1,$2,$3,'draft') RETURNING *`,
      [req.user.org_id, ws, `Semana del ${ws}`]
    )).rows[0];
  }
  if (sched.status === 'published' && !body.force) {
    throw new HttpError(409, 'La semana ya está publicada. Usa "forzar" para añadir sobre la publicada.', 'PUBLISHED');
  }

  const { rules } = (await q(`SELECT rules FROM organizations WHERE id = $1`, [req.user.org_id])).rows[0];

  const existing = await q(
    `SELECT id, date, start_time, end_time, user_id FROM shifts WHERE schedule_id = $1`,
    [sched.id]
  );
  const around = await shiftsAround(req.user.org_id, ws);

  const hm = (t) => (t || '').slice(0, 5);
  let created = 0, skipped = 0, ruleSkips = 0;
  for (let di = 0; di < 7; di++) {
    const date = addDays(ws, di);
    for (const s of days[di]) {
      // ¿Ya existe un turno idéntico ese día (misma hora) para la misma persona o abierto?
      const dup = existing.rows.some((e) => e.date === date && hm(e.start_time) === hm(s.start_time) && hm(e.end_time) === hm(s.end_time) && (s.user_id ? e.user_id === s.user_id : e.user_id === null));
      if (dup) { skipped++; continue; }

      if (s.user_id) {
        const uRow = (await q(`SELECT first_name, weekly_hours FROM users WHERE id = $1 AND org_id = $2`, [s.user_id, req.user.org_id])).rows[0];
        if (!uRow) { skipped++; continue; }
        const violations = checkShiftRules({
          rules, user: uRow, weekStart: ws,
          candidate: { user_id: s.user_id, date, start_time: s.start_time, end_time: s.end_time, break_minutes: s.break_minutes || 0 },
          existingShifts: around,
        });
        if (violations.length) {
          ruleSkips++;
          if (!body.force) { skipped++; continue; }
        }
      }
      const ins = await q(
        `INSERT INTO shifts (schedule_id, org_id, department_id, user_id, date, start_time, end_time, break_minutes, notes)
         VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [sched.id, req.user.org_id, s.user_id, date, s.start_time, s.end_time, s.break_minutes || 0, s.name || null]
      );
      existing.rows.push({ id: ins.rows[0].id, date, start_time: s.start_time, end_time: s.end_time, user_id: s.user_id });
      around.push({ id: ins.rows[0].id, date, start_time: s.start_time, end_time: s.end_time, break_minutes: s.break_minutes || 0, user_id: s.user_id });
      created++;
    }
  }
  audit(req, 'pattern.applied', 'week_pattern', pattern.id, { week_start: ws, created, rule_skips: ruleSkips });
  if (created > 0) {
    const ids = [...new Set(days.flat().map((s) => s.user_id).filter(Boolean))];
    if (ids.length) {
      notify(req.user.org_id, ids, 'schedule', 'Nuevo turno asignado', `Se aplicó el patrón "${pattern.name}" a la semana del ${ws}`, `/app/horario`).catch(() => {});
    }
  }
  res.json({ created, skipped, week_start: ws, schedule_id: sched.id });
}));
