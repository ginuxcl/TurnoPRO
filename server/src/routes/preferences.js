import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncH } from '../middleware/errors.js';
import { assertOwnerOrManager } from '../middleware/scope.js';
import { isValidDate } from '../utils/time.js';

export const preferencesRouter = Router();
preferencesRouter.use(requireAuth);

const MAX_DATES = 90;
const schema = z.object({
  blocked_dates: z.array(z.string().refine(isValidDate, 'Fecha inválida')).max(MAX_DATES),
});

// Preferencias propias (días bloqueados: el autocompletado los evita)
preferencesRouter.get('/me', asyncH(async (req, res) => {
  const { rows } = await q(`SELECT blocked_dates FROM preferences WHERE user_id = $1`, [req.user.id]);
  res.json({ blocked_dates: rows[0]?.blocked_dates || [] });
}));

preferencesRouter.put('/me', asyncH(async (req, res) => {
  const d = schema.parse(req.body);
  const unique = [...new Set(d.blocked_dates)].sort();
  await q(
    `INSERT INTO preferences (user_id, org_id, blocked_dates) VALUES ($1,$2,$3)
     ON CONFLICT (user_id) DO UPDATE SET blocked_dates = EXCLUDED.blocked_dates, updated_at = now()`,
    [req.user.id, req.user.org_id, JSON.stringify(unique)]
  );
  res.json({ blocked_dates: unique });
}));

// Versión para el gestor (modal de turnos): disponibilidad + días bloqueados
preferencesRouter.get('/of/:userId', asyncH(async (req, res) => {
  const targetId = req.params.userId === 'me' ? req.user.id : req.params.userId;
  assertOwnerOrManager(req, targetId);
  const { rows } = await q(
    `SELECT blocked_dates FROM preferences WHERE user_id = $1 AND org_id = $2`,
    [targetId, req.user.org_id]
  );
  res.json({ blocked_dates: rows[0]?.blocked_dates || [] });
}));
