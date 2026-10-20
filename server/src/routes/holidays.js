import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncH, HttpError } from '../middleware/errors.js';
import { fetchScoped } from '../middleware/scope.js';
import { isValidDate } from '../utils/time.js';
import { audit } from '../middleware/audit.js';

export const holidaysRouter = Router();
holidaysRouter.use(requireAuth);

const schema = z.object({
  date: z.string().refine(isValidDate, 'Fecha inválida'),
  name: z.string().trim().min(1).max(60),
});

// Festivos visibles para todos (se pintan en el calendario)
holidaysRouter.get('/', asyncH(async (req, res) => {
  const from = isValidDate(req.query.from) ? req.query.from : null;
  const to = isValidDate(req.query.to) ? req.query.to : null;
  const { rows } = await q(
    `SELECT * FROM holidays WHERE org_id = $1
       AND ($2::date IS NULL OR date >= $2) AND ($3::date IS NULL OR date <= $3)
      ORDER BY date`,
    [req.user.org_id, from, to]
  );
  res.json({ holidays: rows });
}));

holidaysRouter.post('/', requireRole('manager'), asyncH(async (req, res) => {
  const d = schema.parse(req.body);
  const dup = await q(`SELECT 1 FROM holidays WHERE org_id = $1 AND date = $2`, [req.user.org_id, d.date]);
  if (dup.rows[0]) throw new HttpError(409, 'Ya existe un festivo en esa fecha', 'DUPLICATE');
  const { rows } = await q(
    `INSERT INTO holidays (org_id, date, name) VALUES ($1,$2,$3) RETURNING *`,
    [req.user.org_id, d.date, d.name]
  );
  audit(req, 'holiday.created', 'holiday', rows[0].id, { date: d.date, name: d.name });
  res.status(201).json({ holiday: rows[0] });
}));

holidaysRouter.delete('/:id', requireRole('manager'), asyncH(async (req, res) => {
  const h = await fetchScoped('holidays', req.params.id, req.user.org_id);
  await q(`DELETE FROM holidays WHERE id = $1`, [h.id]);
  audit(req, 'holiday.deleted', 'holiday', h.id);
  res.json({ ok: true });
}));
