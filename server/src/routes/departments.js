import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncH, HttpError } from '../middleware/errors.js';
import { fetchScoped } from '../middleware/scope.js';
import { audit } from '../middleware/audit.js';

export const departmentsRouter = Router();
departmentsRouter.use(requireAuth);

const schema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0ea5e9'),
});

departmentsRouter.get('/', asyncH(async (req, res) => {
  const { rows } = await q(
    `SELECT d.*, (SELECT count(*) FROM users u WHERE u.department_id = d.id AND u.is_active) AS members
       FROM departments d WHERE d.org_id = $1 ORDER BY d.name`,
    [req.user.org_id]
  );
  res.json({ departments: rows });
}));

departmentsRouter.post('/', requireRole('manager'), asyncH(async (req, res) => {
  const d = schema.parse(req.body);
  try {
    const { rows } = await q(
      'INSERT INTO departments (org_id, name, color) VALUES ($1,$2,$3) RETURNING *',
      [req.user.org_id, d.name, d.color]
    );
    audit(req, 'department.created', 'department', rows[0].id, { name: d.name });
    res.status(201).json({ department: rows[0] });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Ya existe un departamento con ese nombre', 'DUP');
    throw e;
  }
}));

departmentsRouter.patch('/:id', requireRole('manager'), asyncH(async (req, res) => {
  const dep = await fetchScoped('departments', req.params.id, req.user.org_id);
  const d = schema.partial().parse(req.body);
  const { rows } = await q(
    'UPDATE departments SET name = COALESCE($2, name), color = COALESCE($3, color) WHERE id = $1 AND org_id = $4 RETURNING *',
    [dep.id, d.name ?? null, d.color ?? null, req.user.org_id]
  );
  audit(req, 'department.updated', 'department', dep.id);
  res.json({ department: rows[0] });
}));

departmentsRouter.delete('/:id', requireRole('manager'), asyncH(async (req, res) => {
  const dep = await fetchScoped('departments', req.params.id, req.user.org_id);
  await q('DELETE FROM departments WHERE id = $1 AND org_id = $2', [dep.id, req.user.org_id]);
  audit(req, 'department.deleted', 'department', dep.id, { name: dep.name });
  res.json({ ok: true });
}));
