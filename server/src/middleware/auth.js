import { q } from '../db.js';
import { verifyAccessToken } from '../utils/tokens.js';
import { HttpError } from './errors.js';

const ROLE_RANK = { employee: 0, manager: 1, owner: 2 };

/**
 * requireAuth: valida el Bearer token, carga el usuario activo y lo adjunta a req.
 * Bloquea cuentas desactivadas o bloqueadas.
 */
export const requireAuth = async (req, _res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'No autenticado', 'NO_AUTH');

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw new HttpError(401, 'Sesión inválida o expirada', 'BAD_TOKEN');
    }

    const { rows } = await q(
      `SELECT id, org_id, email, first_name, last_name, role, color, position,
              weekly_hours, is_active, locked_until
         FROM users WHERE id = $1`,
      [payload.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      throw new HttpError(401, 'Cuenta no disponible', 'INACTIVE');
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new HttpError(423, 'Cuenta bloqueada temporalmente', 'LOCKED');
    }

    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
};

/**
 * requireRole('manager'): exige rol mínimo. owner > manager > employee.
 */
export const requireRole = (minRole) => (req, _res, next) => {
  if (ROLE_RANK[req.user?.role] === undefined) {
    return next(new HttpError(403, 'Rol desconocido', 'BAD_ROLE'));
  }
  if (ROLE_RANK[req.user.role] < ROLE_RANK[minRole]) {
    return next(new HttpError(403, 'No tienes permisos para esta acción', 'FORBIDDEN'));
  }
  next();
};
