import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncH, HttpError } from '../middleware/errors.js';


export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', asyncH(async (req, res) => {
  const { rows } = await q(
    `SELECT id, type, title, body, link, read_at, created_at
       FROM notifications WHERE user_id = $1 AND org_id = $2
      ORDER BY created_at DESC LIMIT 30`,
    [req.user.id, req.user.org_id]
  );
  const { rows: c } = await q(
    `SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND org_id = $2 AND read_at IS NULL`,
    [req.user.id, req.user.org_id]
  );
  res.json({ notifications: rows, unread: Number(c[0].n) });
}));

notificationsRouter.post('/read-all', asyncH(async (req, res) => {
  await q(
    `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND org_id = $2 AND read_at IS NULL`,
    [req.user.id, req.user.org_id]
  );
  res.json({ ok: true });
}));

notificationsRouter.post('/:id/read', asyncH(async (req, res) => {
  // id numérico (BIGSERIAL): validar sin el validador UUID de fetchScoped
  if (!/^\d{1,12}$/.test(req.params.id || '')) throw new HttpError(404, 'Recurso no encontrado', 'NOT_FOUND');
  const { rows } = await q(
    'SELECT * FROM notifications WHERE id = $1 AND org_id = $2',
    [req.params.id, req.user.org_id]
  );
  const notif = rows[0];
  if (!notif || notif.user_id !== req.user.id) throw new HttpError(404, 'Recurso no encontrado', 'NOT_FOUND');
  await q('UPDATE notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL', [notif.id]);
  res.json({ ok: true });
}));
