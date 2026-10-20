import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncH, HttpError } from '../middleware/errors.js';
import { fetchScoped } from '../middleware/scope.js';
import { isValidDate, addDays, weekStart, todayStr } from '../utils/time.js';
import { audit } from '../middleware/audit.js';

// ---------- Gestión de API keys (solo gestores) ----------
export const apiKeysRouter = Router();
apiKeysRouter.use(requireAuth, requireRole('manager'));

const schema = z.object({ name: z.string().trim().min(1).max(60) });

apiKeysRouter.get('/', asyncH(async (req, res) => {
  const { rows } = await q(
    `SELECT id, name, prefix, last_used_at, revoked_at, created_at FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC`,
    [req.user.org_id]
  );
  res.json({ keys: rows });
}));

apiKeysRouter.post('/', asyncH(async (req, res) => {
  const d = schema.parse(req.body);
  const key = `tpk_${randomBytes(24).toString('hex')}`;
  const hash = createHash('sha256').update(key).digest('hex');
  const { rows } = await q(
    `INSERT INTO api_keys (org_id, name, prefix, key_hash) VALUES ($1,$2,$3,$4) RETURNING id, name, prefix, created_at`,
    [req.user.org_id, d.name, key.slice(0, 12), hash]
  );
  audit(req, 'apikey.created', 'api_key', rows[0].id, { name: d.name });
  res.status(201).json({ key_record: rows[0], key }); // la clave completa se muestra UNA vez
}));

apiKeysRouter.delete('/:id', asyncH(async (req, res) => {
  const k = await fetchScoped('api_keys', req.params.id, req.user.org_id);
  await q(`UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [k.id]);
  audit(req, 'apikey.revoked', 'api_key', k.id);
  res.json({ ok: true });
}));

// ---------- API pública de solo lectura (autenticación por X-API-Key) ----------
export const publicApiRouter = Router();

publicApiRouter.use(asyncH(async (req, res, next) => {
  const key = req.header('x-api-key') || '';
  if (!/^tpk_[a-f0-9]{48}$/.test(key)) throw new HttpError(401, 'API key ausente o con formato inválido', 'UNAUTHORIZED');
  const hash = createHash('sha256').update(key).digest('hex');
  const { rows } = await q(`SELECT * FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`, [hash]);
  if (!rows[0]) throw new HttpError(401, 'API key inválida o revocada', 'UNAUTHORIZED');
  req.org_id = rows[0].org_id;
  q(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [rows[0].id]).catch(() => {});
  next();
}));

// Turnos publicados (solo lectura, acotado a la org de la clave)
publicApiRouter.get('/v1/shifts', asyncH(async (req, res) => {
  const from = isValidDate(req.query.from) ? req.query.from : addDays(weekStart(todayStr()), -7);
  const to = isValidDate(req.query.to) ? req.query.to : addDays(from, 28);
  if (new Date(to) - new Date(from) > 120 * 86400000) throw new HttpError(400, 'Rango máximo: 120 días', 'BAD_RANGE');
  const { rows } = await q(
    `SELECT sh.date, sh.start_time, sh.end_time, sh.break_minutes,
            u.first_name || ' ' || u.last_name AS person,
            d.name AS department, sh.notes AS template, sc.status
       FROM shifts sh
       JOIN schedules sc ON sc.id = sh.schedule_id AND sc.status = 'published'
       LEFT JOIN users u ON u.id = sh.user_id
       LEFT JOIN departments d ON d.id = sh.department_id
      WHERE sh.org_id = $1 AND sh.date BETWEEN $2 AND $3
      ORDER BY sh.date, sh.start_time`,
    [req.org_id, from, to]
  );
  res.json({ object: 'list', from, to, data: rows });
}));

publicApiRouter.get('/v1/employees', asyncH(async (req, res) => {
  const { rows } = await q(
    `SELECT u.first_name, u.last_name, u.position, d.name AS department, u.weekly_hours
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.org_id = $1 AND u.is_active = TRUE ORDER BY u.first_name`,
    [req.org_id]
  );
  res.json({ object: 'list', data: rows });
}));
