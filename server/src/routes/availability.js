import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncH, HttpError } from '../middleware/errors.js';
import { assertOwnerOrManager } from '../middleware/scope.js';
import { isValidTime } from '../utils/time.js';
import { audit } from '../middleware/audit.js';

export const availabilityRouter = Router();
availabilityRouter.use(requireAuth);

const timeStr = z.string().refine(isValidTime, 'Hora inválida (HH:MM)');

const schema = z.object({
  weekdays: z.array(z.boolean()).length(7),
  start_time: timeStr,
  end_time: timeStr,
  notes: z.string().trim().max(300).optional().nullable(),
});

// Obtener disponibilidad propia o de un miembro (manager+ o uno mismo) — anti-IDOR
availabilityRouter.get('/:userId', asyncH(async (req, res) => {
  const targetId = req.params.userId === 'me' ? req.user.id : req.params.userId;
  assertOwnerOrManager(req, targetId);
  const { rows } = await q(
    'SELECT * FROM availability WHERE user_id = $1 AND org_id = $2',
    [targetId, req.user.org_id]
  );
  const a = rows[0];
  const prefs = await q(`SELECT blocked_dates FROM preferences WHERE user_id = $1 AND org_id = $2`, [targetId, req.user.org_id]);
  res.json({
    availability: a
      ? { weekdays: a.weekdays, start_time: a.start_time.slice(0, 5), end_time: a.end_time.slice(0, 5), notes: a.notes }
      : { weekdays: [true, true, true, true, true, false, false], start_time: '09:00', end_time: '17:00', notes: '' },
    blocked_dates: prefs.rows[0]?.blocked_dates || [],
  });
}));

availabilityRouter.put('/', asyncH(async (req, res) => {
  const d = schema.parse(req.body);
  if (d.start_time >= d.end_time) throw new HttpError(400, 'La hora de inicio debe ser anterior a la de fin', 'BAD_RANGE');
  const weekdays = d.weekdays.map((b) => (b ? 1 : 0));
  await q(
    `INSERT INTO availability (org_id, user_id, weekdays, start_time, end_time, notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id) DO UPDATE SET
       weekdays = EXCLUDED.weekdays, start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time, notes = EXCLUDED.notes, updated_at = now()`,
    [req.user.org_id, req.user.id, JSON.stringify(weekdays), d.start_time, d.end_time, d.notes ?? null]
  );
  audit(req, 'availability.updated', 'user', req.user.id);
  res.json({ ok: true });
}));
