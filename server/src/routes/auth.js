import { Router } from 'express';
import { z } from 'zod';
import { q, withTx } from '../db.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword, newOpaqueToken, sha256 } from '../utils/passwords.js';
import { signAccessToken } from '../utils/tokens.js';
import { asyncH, HttpError } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { loginLimiter, registerLimiter } from '../middleware/rateLimit.js';

export const authRouter = Router();

const REFRESH_COOKIE = 'turnos_rt';

const registerSchema = z.object({
  org_name: z.string().trim().min(2).max(80),
  first_name: z.string().trim().min(1).max(60),
  last_name: z.string().trim().min(1).max(60),
  email: z.string().trim().toLowerCase().email().max(120),
  password: z
    .string()
    .min(10, 'La contraseña debe tener al menos 10 caracteres')
    .max(128)
    .regex(/[a-z]/, 'Incluye al menos una minúscula')
    .regex(/[A-Z]/, 'Incluye al menos una mayúscula')
    .regex(/[0-9]/, 'Incluye al menos un número'),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(1).max(128),
});

function slugify(name) {
  const base = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'org';
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: config.refreshTokenDays * 24 * 60 * 60 * 1000,
  });
}

async function issueSession(req, res, user) {
  const accessToken = signAccessToken(user);
  const refreshToken = newOpaqueToken();
  await q(
    `INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at, user_agent, ip)
     VALUES ($1,$2,$3, now() + ($4 || ' days')::interval, $5, $6)`,
    [user.id, sha256(refreshToken), crypto.randomUUID(), String(config.refreshTokenDays),
     (req.headers['user-agent'] || '').slice(0, 200), req.ip]
  );
  setRefreshCookie(res, refreshToken);
  return accessToken;
}

function publicUser(u) {
  return {
    id: u.id,
    org_id: u.org_id,
    email: u.email,
    first_name: u.first_name,
    last_name: u.last_name,
    role: u.role,
    color: u.color,
    position: u.position,
    weekly_hours: u.weekly_hours,
  };
}

// ---------- Registro: crea organización + usuario owner ----------
authRouter.post('/register', registerLimiter, asyncH(async (req, res) => {
  const data = registerSchema.parse(req.body);
  const exists = await q('SELECT 1 FROM users WHERE email = $1', [data.email]);
  if (exists.rows[0]) throw new HttpError(409, 'Ese email ya está registrado', 'EMAIL_TAKEN');

  const passwordHash = await hashPassword(data.password);
  const user = await withTx(async (tx) => {
    const org = await tx.query(
      'INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING *',
      [data.org_name, slugify(data.org_name)]
    );
    const u = await tx.query(
      `INSERT INTO users (org_id, email, password_hash, first_name, last_name, role)
       VALUES ($1,$2,$3,$4,$5,'owner') RETURNING *`,
      [org.rows[0].id, data.email, passwordHash, data.first_name, data.last_name]
    );
    return u.rows[0];
  });

  const accessToken = await issueSession(req, res, user);
  req.user = { org_id: user.org_id, id: user.id };
  audit(req, 'auth.register', 'user', user.id, { org: data.org_name });
  res.status(201).json({ access_token: accessToken, user: publicUser(user) });
}));

// ---------- Login con bloqueo por intentos fallidos ----------
authRouter.post('/login', loginLimiter, asyncH(async (req, res) => {
  const data = loginSchema.parse(req.body);
  const { rows } = await q('SELECT * FROM users WHERE email = $1', [data.email]);
  const user = rows[0];

  // Respuesta uniforme: no revelar si el email existe
  const genericError = new HttpError(401, 'Credenciales incorrectas', 'BAD_CREDENTIALS');
  if (!user) {
    // Igualar el tiempo de respuesta para no filtrar la existencia del email por timing
    await hashPassword(data.password);
    throw genericError;
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new HttpError(423, 'Cuenta bloqueada temporalmente por intentos fallidos. Prueba más tarde.', 'LOCKED');
  }

  const ok = await verifyPassword(data.password, user.password_hash);
  if (!ok) {
    const attempts = user.failed_attempts + 1;
    const lock = attempts >= 5 ? "now() + interval '15 minutes'" : 'null';
    await q(
      `UPDATE users SET failed_attempts = $2,
        locked_until = COALESCE(${lock}, locked_until),
        is_active = CASE WHEN $2 >= 8 THEN false ELSE is_active END
       WHERE id = $1`,
      [user.id, attempts]
    );
    audit(req, 'auth.login_failed', 'user', user.id, { attempts }, user.org_id);
    throw genericError;
  }
  if (!user.is_active) throw new HttpError(403, 'Cuenta desactivada. Contacta con tu administrador.', 'INACTIVE');

  await q('UPDATE users SET failed_attempts = 0, locked_until = null, last_login_at = now() WHERE id = $1', [user.id]);
  const accessToken = await issueSession(req, res, user);
  audit(req, 'auth.login', 'user', user.id, {}, user.org_id);
  res.json({ access_token: accessToken, user: publicUser(user) });
}));

// ---------- Refresh con rotación y detección de reuso ----------
authRouter.post('/refresh', asyncH(async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) throw new HttpError(401, 'Sesión expirada', 'NO_SESSION');

  const hash = sha256(raw);
  const { rows } = await q(
    `SELECT rt.*, u.id AS u_id, u.org_id, u.role, u.is_active, u.first_name, u.last_name,
            u.email, u.color, u.position, u.weekly_hours
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = $1`,
    [hash]
  );
  const row = rows[0];

  if (!row) {
    // Token desconocido: posible reuso de un token ya rotado → revocar familia completa
    setRefreshCookie(res, '');
    throw new HttpError(401, 'Sesión inválida', 'BAD_SESSION');
  }
  if (row.revoked_at) {
    // REUSO detectado: revocar toda la familia de tokens
    await q('UPDATE refresh_tokens SET revoked_at = now() WHERE family = $1', [row.family]);
    audit(req, 'auth.refresh_reuse_detected', 'user', row.u_id, { family: row.family }, row.org_id);
    setRefreshCookie(res, '');
    throw new HttpError(401, 'Sesión revocada por seguridad. Vuelve a iniciar sesión.', 'REUSE');
  }
  if (new Date(row.expires_at) < new Date()) {
    setRefreshCookie(res, '');
    throw new HttpError(401, 'Sesión expirada', 'EXPIRED');
  }
  if (!row.is_active) {
    setRefreshCookie(res, '');
    throw new HttpError(401, 'Cuenta no disponible', 'INACTIVE');
  }

  // Rotación: revocar el usado y emitir uno nuevo
  await q('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
  const user = {
    id: row.u_id, org_id: row.org_id, role: row.role, email: row.email,
    first_name: row.first_name, last_name: row.last_name,
    color: row.color, position: row.position, weekly_hours: row.weekly_hours,
  };
  const accessToken = signAccessToken(user);
  const newToken = newOpaqueToken();
  await q(
    `INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at, user_agent, ip)
     VALUES ($1,$2,$3, now() + ($4 || ' days')::interval, $5, $6)`,
    [user.id, sha256(newToken), row.family, String(config.refreshTokenDays),
     (req.headers['user-agent'] || '').slice(0, 200), req.ip]
  );
  setRefreshCookie(res, newToken);
  res.json({ access_token: accessToken, user: publicUser(user) });
}));

// ---------- Logout: revoca el refresh token ----------
authRouter.post('/logout', asyncH(async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (raw) {
    await q('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
      [sha256(raw)]);
    if (req.user) audit(req, 'auth.logout', 'user', req.user.id);
  }
  setRefreshCookie(res, '');
  res.json({ ok: true });
}));
