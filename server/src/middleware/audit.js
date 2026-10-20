import { q } from '../db.js';

/**
 * Registro de auditoría (fire-and-forget): acción, actor, entidad e IP.
 * Nunca lanza: la auditoría no debe romper la petición.
 */
export function audit(req, action, entityType, entityId, details, orgIdOverride) {
  const orgId = orgIdOverride || req.user?.org_id || null;
  const actorId = req.user?.id || null;
  const ip = req.ip || null;
  q(
    `INSERT INTO audit_logs (org_id, actor_id, action, entity_type, entity_id, details, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [orgId, actorId, action, entityType, entityId || null, details ? JSON.stringify(details) : null, ip]
  ).catch((e) => console.error('[audit] fallo al registrar:', e.message));
}
