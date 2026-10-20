import { q } from '../db.js';

/**
 * Crea notificaciones in-app para uno o varios usuarios. Fire-and-forget.
 */
export async function notify(orgId, userIds, type, title, body, link) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  try {
    await q(
      `INSERT INTO notifications (org_id, user_id, type, title, body, link)
       SELECT $1, u, $2, $3, $4, $5 FROM unnest($6::uuid[]) AS u`,
      [orgId, type, title, body || null, link || null, ids]
    );
  } catch (e) {
    console.error('[notify] fallo:', e.message);
  }
}

// IDs de los gestores (owner + manager) activos de una organización
export async function managerIds(orgId) {
  const { rows } = await q(
    `SELECT id FROM users WHERE org_id = $1 AND role IN ('owner','manager') AND is_active`,
    [orgId]
  );
  return rows.map((r) => r.id);
}

// Todos los usuarios activos de la organización
export async function activeUserIds(orgId) {
  const { rows } = await q('SELECT id FROM users WHERE org_id = $1 AND is_active', [orgId]);
  return rows.map((r) => r.id);
}
