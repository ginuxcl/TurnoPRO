import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncH } from '../middleware/errors.js';

export const auditRouter = Router();

// Solo owner/manager ven el registro de auditoría de su organización
auditRouter.get('/', requireAuth, requireRole('manager'), asyncH(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 80, 200);
  const { rows } = await q(
    `SELECT a.*, u.first_name || ' ' || u.last_name AS actor_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.org_id = $1
      ORDER BY a.created_at DESC LIMIT $2`,
    [req.user.org_id, limit]
  );
  res.json({ logs: rows });
}));
