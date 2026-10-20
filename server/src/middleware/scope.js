import { q } from '../db.js';
import { HttpError } from './errors.js';

/**
 * Anti-IDOR/BOLA: cualquier objeto se busca SIEMPRE acotado a la organización
 * del usuario autenticado. Si no pertenece a su org → 404 (no 403, para no
 * confirmar la existencia del recurso a un atacante).
 */
export async function fetchScoped(table, id, orgId) {
  if (!/^[0-9a-fA-F-]{36}$/.test(id || '')) {
    throw new HttpError(404, 'Recurso no encontrado', 'NOT_FOUND');
  }
  const { rows } = await q(
    `SELECT * FROM ${table} WHERE id = $1 AND org_id = $2`,
    [id, orgId]
  );
  if (!rows[0]) throw new HttpError(404, 'Recurso no encontrado', 'NOT_FOUND');
  return rows[0];
}

/**
 * Propiedad estricta: el objeto debe existir en la org Y pertenecer al usuario
 * (o el actor debe ser manager+).
 */
export function assertOwnerOrManager(req, resourceUserId) {
  if (req.user.role === 'employee' && req.user.id !== resourceUserId) {
    throw new HttpError(404, 'Recurso no encontrado', 'NOT_FOUND');
  }
}
