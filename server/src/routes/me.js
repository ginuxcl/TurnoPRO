import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { hashPassword, verifyPassword } from '../utils/passwords.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncH, HttpError } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { RULE_DEFAULTS } from '../utils/rules.js';

export const meRouter = Router();
meRouter.use(requireAuth);

function publicUser(u) {
  return {
    id: u.id, org_id: u.org_id, email: u.email,
    first_name: u.first_name, last_name: u.last_name,
    role: u.role, color: u.color, position: u.position, weekly_hours: u.weekly_hours,
  };
}

meRouter.get('/', asyncH(async (req, res) => {
  const { rows } = await q(
    `SELECT u.*, o.name AS org_name, o.timezone, o.rules
       FROM users u JOIN organizations o ON o.id = u.org_id
      WHERE u.id = $1`, [req.user.id]
  );
  const r = rows[0];
  res.json({
    user: publicUser(r),
    org: { name: r.org_name, timezone: r.timezone, rules: { ...RULE_DEFAULTS, ...(r.rules || {}) } },
  });
}));

const rulesSchema = z.object({
  max_shifts_per_day: z.number().int().min(1).max(4).nullable(),
  min_rest_hours: z.number().int().min(0).max(16).nullable(),
  max_consecutive_days: z.number().int().min(1).max(14).nullable(),
  max_weekly_hours: z.number().int().min(1).max(80).nullable(),
});

// Guardar reglas de planificación (gestores)
meRouter.patch('/org/rules', requireRole('manager'), asyncH(async (req, res) => {
  const rules = rulesSchema.parse({ ...RULE_DEFAULTS, ...req.body });
  await q('UPDATE organizations SET rules = $2 WHERE id = $1', [req.user.org_id, JSON.stringify(rules)]);
  audit(req, 'org.rules_updated', 'organization', req.user.org_id, rules);
  res.json({ rules });
}));

const profileSchema = z.object({
  first_name: z.string().trim().min(1).max(60).optional(),
  last_name: z.string().trim().min(1).max(60).optional(),
  phone: z.string().trim().max(30).optional().nullable(),
  position: z.string().trim().max(80).optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

meRouter.patch('/', asyncH(async (req, res) => {
  const d = profileSchema.parse(req.body);
  const { rows } = await q(
    `UPDATE users SET first_name = COALESCE($2, first_name),
            last_name  = COALESCE($3, last_name),
            phone      = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE phone END,
            position   = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE position END,
            color      = COALESCE($6, color),
            updated_at = now()
      WHERE id = $1 RETURNING *`,
    [req.user.id, d.first_name ?? null, d.last_name ?? null, d.phone ?? null, d.position ?? null, d.color ?? null]
  );
  audit(req, 'me.profile_updated', 'user', req.user.id);
  res.json({ user: publicUser(rows[0]) });
}));

const passwordSchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: z.string().min(10, 'Mínimo 10 caracteres').max(128)
    .regex(/[a-z]/, 'Incluye una minúscula')
    .regex(/[A-Z]/, 'Incluye una mayúscula')
    .regex(/[0-9]/, 'Incluye un número'),
});

meRouter.post('/password', asyncH(async (req, res) => {
  const d = passwordSchema.parse(req.body);
  const { rows } = await q('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const ok = await verifyPassword(d.current_password, rows[0].password_hash);
  if (!ok) throw new HttpError(401, 'La contraseña actual no es correcta', 'BAD_PASSWORD');
  const hash = await hashPassword(d.new_password);
  await q('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [req.user.id, hash]);
  // Revocar todas las sesiones activas tras cambio de contraseña
  await q('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [req.user.id]);
  audit(req, 'me.password_changed', 'user', req.user.id);
  res.json({ ok: true });
}));
