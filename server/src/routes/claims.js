import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncH, HttpError } from '../middleware/errors.js';
import { fetchScoped, assertOwnerOrManager } from '../middleware/scope.js';
import { audit } from '../middleware/audit.js';
import { notify, managerIds } from '../utils/notify.js';

export const claimsRouter = Router();
claimsRouter.use(requireAuth);

// Listar reclamaciones: manager ve todas; empleado solo las suyas
claimsRouter.get('/', asyncH(async (req, res) => {
  const onlyMine = req.user.role === 'employee';
  const params = [req.user.org_id];
  if (onlyMine) params.push(req.user.id);
  const { rows } = await q(
    `SELECT c.*, sh.date, sh.start_time, sh.end_time, sh.break_minutes,
            u.first_name || ' ' || u.last_name AS user_name, u.color AS user_color,
            (SELECT count(*) FROM shift_claims x WHERE x.shift_id = c.shift_id AND x.status = 'pending') AS pending_count
       FROM shift_claims c
       JOIN shifts sh ON sh.id = c.shift_id
       JOIN users u ON u.id = c.user_id
      WHERE c.org_id = $1 ${onlyMine ? 'AND c.user_id = $2' : ''}
      ORDER BY c.created_at DESC LIMIT 200`,
    params
  );
  res.json({ claims: rows });
}));

// Aprobar: asigna el turno al solicitante si sigue abierto
claimsRouter.post('/:id/approve', requireRole('manager'), asyncH(async (req, res) => {
  const claim = await fetchScoped('shift_claims', req.params.id, req.user.org_id);
  if (claim.status !== 'pending') throw new HttpError(409, 'Esta solicitud ya fue revisada', 'REVIEWED');

  const shift = await fetchScoped('shifts', claim.shift_id, req.user.org_id);
  if (shift.user_id && shift.user_id !== claim.user_id) {
    await q(`UPDATE shift_claims SET status='rejected', reviewed_by=$2, reviewed_at=now() WHERE id=$1`, [claim.id, req.user.id]);
    throw new HttpError(409, 'El turno ya no está abierto', 'TAKEN');
  }

  await q(
    `UPDATE shift_claims SET status='approved', reviewed_by=$2, reviewed_at=now() WHERE id=$1`,
    [claim.id, req.user.id]
  );
  await q(
    `UPDATE shifts SET user_id = $2, updated_at = now() WHERE id = $1 AND org_id = $3 AND user_id IS NULL`,
    [shift.id, claim.user_id, req.user.org_id]
  );
  // El resto de solicitudes del mismo turno quedan rechazadas
  await q(
    `UPDATE shift_claims SET status='rejected', reviewed_by=$2, reviewed_at=now()
      WHERE shift_id=$1 AND status='pending' AND id <> $3`,
    [shift.id, req.user.id, claim.id]
  );
  audit(req, 'claim.approved', 'shift_claim', claim.id, { shift: shift.id, user: claim.user_id });
  await notify(req.user.org_id, [claim.user_id], 'claim',
    '¡Tu reclamación fue aprobada! Ya tienes el turno asignado', `${shift.date}`, '/app/mis-turnos');
  res.json({ ok: true });
}));

claimsRouter.post('/:id/reject', requireRole('manager'), asyncH(async (req, res) => {
  const claim = await fetchScoped('shift_claims', req.params.id, req.user.org_id);
  if (claim.status !== 'pending') throw new HttpError(409, 'Esta solicitud ya fue revisada', 'REVIEWED');
  await q(`UPDATE shift_claims SET status='rejected', reviewed_by=$2, reviewed_at=now() WHERE id=$1`,
    [claim.id, req.user.id]);
  audit(req, 'claim.rejected', 'shift_claim', claim.id);
  const sh = await fetchScoped('shifts', claim.shift_id, req.user.org_id);
  await notify(req.user.org_id, [claim.user_id], 'claim',
    'Tu reclamación de turno fue rechazada', `${sh.date}`, '/app/mis-turnos');
  res.json({ ok: true });
}));

// El solicitante puede cancelar su propia solicitud
claimsRouter.post('/:id/cancel', asyncH(async (req, res) => {
  const claim = await fetchScoped('shift_claims', req.params.id, req.user.org_id);
  assertOwnerOrManager(req, claim.user_id);
  if (claim.status !== 'pending') throw new HttpError(409, 'Solo puedes cancelar solicitudes pendientes', 'REVIEWED');
  await q(`UPDATE shift_claims SET status='cancelled', reviewed_at=now() WHERE id=$1`, [claim.id]);
  audit(req, 'claim.cancelled', 'shift_claim', claim.id);
  res.json({ ok: true });
}));
