import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncH } from '../middleware/errors.js';
import { fetchScoped } from '../middleware/scope.js';
import { audit } from '../middleware/audit.js';
import { isValidTime } from '../utils/time.js';

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

const timeStr = z.string().refine(isValidTime, 'Hora inválida (HH:MM)');

const schema = z.object({
  name: z.string().trim().min(1).max(60),
  start_time: timeStr,
  end_time: timeStr,
  break_minutes: z.number().int().min(0).max(480).default(0),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
  department_id: z.string().uuid().optional().nullable(),
});

templatesRouter.get('/', asyncH(async (req, res) => {
  const { rows } = await q(
    'SELECT * FROM shift_templates WHERE org_id = $1 ORDER BY start_time',
    [req.user.org_id]
  );
  res.json({ templates: rows });
}));

templatesRouter.post('/', requireRole('manager'), asyncH(async (req, res) => {
  const d = schema.parse(req.body);
  const { rows } = await q(
    `INSERT INTO shift_templates (org_id, name, start_time, end_time, break_minutes, color, department_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.user.org_id, d.name, d.start_time, d.end_time, d.break_minutes, d.color, d.department_id ?? null]
  );
  audit(req, 'template.created', 'shift_template', rows[0].id, { name: d.name });
  res.status(201).json({ template: rows[0] });
}));

templatesRouter.patch('/:id', requireRole('manager'), asyncH(async (req, res) => {
  const tpl = await fetchScoped('shift_templates', req.params.id, req.user.org_id);
  const d = schema.partial().parse(req.body);
  const { rows } = await q(
    `UPDATE shift_templates SET name = COALESCE($2, name), start_time = COALESCE($3, start_time),
       end_time = COALESCE($4, end_time), break_minutes = COALESCE($5, break_minutes),
       color = COALESCE($6, color), department_id = COALESCE($7, department_id)
      WHERE id = $1 AND org_id = $8 RETURNING *`,
    [tpl.id, d.name ?? null, d.start_time ?? null, d.end_time ?? null,
     d.break_minutes ?? null, d.color ?? null, d.department_id ?? null, req.user.org_id]
  );
  audit(req, 'template.updated', 'shift_template', tpl.id);
  res.json({ template: rows[0] });
}));

templatesRouter.delete('/:id', requireRole('manager'), asyncH(async (req, res) => {
  const tpl = await fetchScoped('shift_templates', req.params.id, req.user.org_id);
  await q('DELETE FROM shift_templates WHERE id = $1 AND org_id = $2', [tpl.id, req.user.org_id]);
  audit(req, 'template.deleted', 'shift_template', tpl.id, { name: tpl.name });
  res.json({ ok: true });
}));
