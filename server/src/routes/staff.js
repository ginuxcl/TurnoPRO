import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { hashPassword, newOpaqueToken } from '../utils/passwords.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncH, HttpError } from '../middleware/errors.js';
import { fetchScoped } from '../middleware/scope.js';
import { audit } from '../middleware/audit.js';

export const staffRouter = Router();
staffRouter.use(requireAuth);

const STAFF_COLS = `u.id, u.org_id, u.email, u.first_name, u.last_name, u.role,
  u.position, u.department_id, u.phone, u.color, u.weekly_hours, u.hourly_rate, u.is_active,
  u.invite_token, u.created_at, d.name AS department_name`;

// Sin JOIN (para INSERT/UPDATE ... RETURNING, donde no se puede referenciar 'd')
const STAFF_COLS_PLAIN = STAFF_COLS.replace(/u\./g, '').replace(/, d\.name AS department_name/, '');

// Listar personal: employees solo ven el directorio básico (sin tokens ni emails ajenos... el email es necesario para contactar; se permite en org)
staffRouter.get('/', asyncH(async (req, res) => {
  const { rows } = await q(
    `SELECT ${STAFF_COLS} FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.org_id = $1 ORDER BY u.first_name, u.last_name`,
    [req.user.org_id]
  );
  res.json({ staff: rows });
}));

const createSchema = z.object({
  first_name: z.string().trim().min(1).max(60),
  last_name: z.string().trim().min(1).max(60),
  email: z.string().trim().toLowerCase().email().max(120),
  role: z.enum(['manager', 'employee']).default('employee'),
  position: z.string().trim().max(80).optional().nullable(),
  department_id: z.string().uuid().optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  weekly_hours: z.number().int().min(0).max(80).default(40),
  hourly_rate: z.number().min(0).max(999).optional().nullable(),
  password: z.string().min(10).max(128)
    .regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/),
});

// Crear empleado (manager+). Owner solo se crea en el registro de la organización.
staffRouter.post('/', requireRole('manager'), asyncH(async (req, res) => {
  const d = createSchema.parse(req.body);
  const dup = await q('SELECT 1 FROM users WHERE email = $1', [d.email]);
  if (dup.rows[0]) throw new HttpError(409, 'Ese email ya está en uso', 'EMAIL_TAKEN');

  if (d.department_id) await fetchScoped('departments', d.department_id, req.user.org_id);
  const hash = await hashPassword(d.password);
  const inviteToken = newOpaqueToken();
  const { rows } = await q(
    `INSERT INTO users (org_id, email, password_hash, first_name, last_name, role,
                        position, department_id, phone, color, weekly_hours, hourly_rate, invite_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${STAFF_COLS_PLAIN}`,
    [req.user.org_id, d.email, hash, d.first_name, d.last_name, d.role,
     d.position ?? null, d.department_id ?? null, d.phone ?? null,
     d.color ?? '#6366f1', d.weekly_hours, d.hourly_rate ?? null, inviteToken]
  );
  audit(req, 'staff.created', 'user', rows[0].id, { email: d.email, role: d.role });
  res.status(201).json({ staff: rows[0] });
}));

// Detalle de empleado — anti-IDOR: siempre acotado a la organización
staffRouter.get('/:id', asyncH(async (req, res) => {
  const person = await fetchScoped('users', req.params.id, req.user.org_id);
  const { rows } = await q(
    `SELECT ${STAFF_COLS} FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = $1 AND u.org_id = $2`,
    [person.id, req.user.org_id]
  );
  res.json({ staff: rows[0] });
}));

const updateSchema = z.object({
  first_name: z.string().trim().min(1).max(60).optional(),
  last_name: z.string().trim().min(1).max(60).optional(),
  role: z.enum(['manager', 'employee']).optional(),
  position: z.string().trim().max(80).optional().nullable(),
  department_id: z.string().uuid().optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  weekly_hours: z.number().int().min(0).max(80).optional(),
  hourly_rate: z.number().min(0).max(999).optional().nullable(),
  is_active: z.boolean().optional(),
  new_password: z.string().min(10).max(128)
    .regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).optional(),
});

// Actualizar empleado (manager+). Anti-escalada: nunca permitir asignar 'owner'.
staffRouter.patch('/:id', requireRole('manager'), asyncH(async (req, res) => {
  const person = await fetchScoped('users', req.params.id, req.user.org_id);
  const d = updateSchema.parse(req.body);

  if (person.role === 'owner' && (d.role || d.is_active === false)) {
    throw new HttpError(403, 'No puedes modificar el rol o desactivar al propietario', 'PROTECTED');
  }
  if (d.department_id) await fetchScoped('departments', d.department_id, req.user.org_id);

  let hash = null;
  if (d.new_password) hash = await hashPassword(d.new_password);

  const { rows } = await q(
    `UPDATE users SET
       first_name  = COALESCE($2, first_name),
       last_name   = COALESCE($3, last_name),
       role        = COALESCE($4, role),
       position    = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE position END,
       department_id = CASE WHEN $6::uuid IS NOT NULL THEN $6
                            WHEN $13 THEN NULL ELSE department_id END,
       phone       = CASE WHEN $7::text IS NOT NULL THEN $7 ELSE phone END,
       color       = COALESCE($8, color),
       weekly_hours = COALESCE($9, weekly_hours),
       hourly_rate = CASE WHEN $14::numeric IS NOT NULL THEN $14::numeric
                          WHEN $15 THEN NULL ELSE hourly_rate END,
       is_active   = COALESCE($10, is_active),
       password_hash = COALESCE($11, password_hash),
       invite_token = CASE WHEN $11 IS NOT NULL THEN NULL ELSE invite_token END,
       failed_attempts = 0, locked_until = NULL, updated_at = now()
      WHERE id = $1 AND org_id = $12 RETURNING ${STAFF_COLS_PLAIN}`,
    [person.id, d.first_name ?? null, d.last_name ?? null, d.role ?? null,
     d.position ?? null, d.department_id ?? null, d.phone ?? null, d.color ?? null,
     d.weekly_hours ?? null, d.is_active ?? null, hash ?? null, req.user.org_id,
     d.department_id === null, d.hourly_rate ?? null, d.hourly_rate === null]
  );
  audit(req, 'staff.updated', 'user', person.id, { fields: Object.keys(d) });
  res.json({ staff: rows[0] });
}));

// Desactivar (soft delete) — jamás borrado físico: los turnos históricos se conservan
staffRouter.delete('/:id', requireRole('manager'), asyncH(async (req, res) => {
  const person = await fetchScoped('users', req.params.id, req.user.org_id);
  if (person.role === 'owner') throw new HttpError(403, 'El propietario no puede desactivarse', 'PROTECTED');
  if (person.id === req.user.id) throw new HttpError(403, 'No puedes desactivarte a ti mismo', 'SELF');
  await q('UPDATE users SET is_active = false, updated_at = now() WHERE id = $1 AND org_id = $2',
    [person.id, req.user.org_id]);
  // Cerrar sus sesiones activas
  await q('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [person.id]);
  audit(req, 'staff.deactivated', 'user', person.id);
  res.json({ ok: true });
}));
