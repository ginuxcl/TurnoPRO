import { Router } from 'express';
import { z } from 'zod';
import { q, withTx } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncH, HttpError } from '../middleware/errors.js';
import { fetchScoped, assertOwnerOrManager } from '../middleware/scope.js';
import { audit } from '../middleware/audit.js';
import { notify, managerIds } from '../utils/notify.js';
import { rulesForOrg, checkShiftRules, shiftsAround } from '../utils/rules.js';
import { weekStart } from '../utils/time.js';

export const swapsRouter = Router();
swapsRouter.use(requireAuth);

const SELECT = `
  SELECT sw.*, sh.date, sh.start_time, sh.end_time, sh.break_minutes,
         fu.first_name || ' ' || fu.last_name AS from_name, fu.color AS from_color,
         tu.first_name || ' ' || tu.last_name AS to_name, tu.color AS to_color,
         d.name AS department_name
    FROM swap_requests sw
    JOIN shifts sh ON sh.id = sw.shift_id
    JOIN users fu ON fu.id = sw.from_user_id
    JOIN users tu ON tu.id = sw.to_user_id
    LEFT JOIN departments d ON d.id = sh.department_id`;

// Listar: empleado ve los suyos (ofrecidos o recibidos); gestor ve todos
swapsRouter.get('/', asyncH(async (req, res) => {
  const params = [req.user.org_id];
  let cond = '';
  if (req.user.role === 'employee') {
    cond = 'AND (sw.from_user_id = $2 OR sw.to_user_id = $2)';
    params.push(req.user.id);
  }
  const { rows } = await q(`${SELECT} WHERE sw.org_id = $1 ${cond} ORDER BY sw.created_at DESC LIMIT 200`, params);
  res.json({ swaps: rows });
}));

const createSchema = z.object({
  shift_id: z.string().uuid(),
  to_user_id: z.string().uuid(),
});

// Proponer ceder MI turno a otra persona
swapsRouter.post('/', asyncH(async (req, res) => {
  const d = createSchema.parse(req.body);
  const shift = await fetchScoped('shifts', d.shift_id, req.user.org_id);
  if (shift.user_id !== req.user.id) {
    throw new HttpError(403, 'Solo puedes proponer cambios de tus propios turnos', 'NOT_OWNER');
  }
  const target = await fetchScoped('users', d.to_user_id, req.user.org_id);
  if (!target.is_active) throw new HttpError(400, 'Esa persona no está activa', 'INACTIVE');
  if (target.id === req.user.id) throw new HttpError(400, 'No puedes cederte el turno a ti mismo', 'SELF');
  // Ya hay un turno del destino en conflicto? (aviso, no bloqueo: el gestor decide al aprobar)

  try {
    const { rows } = await q(
      `INSERT INTO swap_requests (org_id, shift_id, from_user_id, to_user_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [req.user.org_id, shift.id, req.user.id, target.id]
    );
    await notify(req.user.org_id, [target.id], 'swap',
      `${req.user.first_name} ${req.user.last_name} quiere cederte un turno`,
      `${shift.date} · ${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}`,
      '/app/solicitudes?tab=swaps');
    audit(req, 'swap.created', 'swap_request', rows[0].id, { shift: shift.id, to: target.id });
    res.status(201).json({ swap: rows[0] });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Ya existe esta propuesta de cambio', 'DUP');
    throw e;
  }
}));

async function loadSwap(req) {
  return fetchScoped('swap_requests', req.params.id, req.user.org_id);
}

// La persona destino acepta o rechaza recibir el turno
swapsRouter.post('/:id/accept', asyncH(async (req, res) => {
  const swap = await loadSwap(req);
  if (swap.to_user_id !== req.user.id) throw new HttpError(404, 'Recurso no encontrado', 'NOT_FOUND');
  if (swap.status !== 'pending') throw new HttpError(409, 'Esta propuesta ya fue gestionada', 'REVIEWED');
  await q(`UPDATE swap_requests SET status='accepted' WHERE id=$1`, [swap.id]);
  const shift = await fetchScoped('shifts', swap.shift_id, req.user.org_id);
  await notify(req.user.org_id, [swap.from_user_id, ...(await managerIds(req.user.org_id))], 'swap',
    `${req.user.first_name} ${req.user.last_name} aceptó el cambio de turno`,
    `Pendiente de aprobación del gestor · ${shift.date}`,
    '/app/solicitudes?tab=swaps');
  audit(req, 'swap.accepted', 'swap_request', swap.id);
  res.json({ ok: true });
}));

swapsRouter.post('/:id/decline', asyncH(async (req, res) => {
  const swap = await loadSwap(req);
  if (swap.to_user_id !== req.user.id) throw new HttpError(404, 'Recurso no encontrado', 'NOT_FOUND');
  if (swap.status !== 'pending') throw new HttpError(409, 'Esta propuesta ya fue gestionada', 'REVIEWED');
  await q(`UPDATE swap_requests SET status='declined', reviewed_by=$2, reviewed_at=now() WHERE id=$1`,
    [swap.id, req.user.id]);
  await notify(req.user.org_id, [swap.from_user_id], 'swap',
    `${req.user.first_name} ${req.user.last_name} declinó tu cambio de turno`, null,
    '/app/mis-turnos');
  audit(req, 'swap.declined', 'swap_request', swap.id);
  res.json({ ok: true });
}));

// El oferente cancela mientras esté en curso
swapsRouter.post('/:id/cancel', asyncH(async (req, res) => {
  const swap = await loadSwap(req);
  assertOwnerOrManager(req, swap.from_user_id);
  if (!['pending', 'accepted'].includes(swap.status)) {
    throw new HttpError(409, 'Solo puedes cancelar cambios en curso', 'REVIEWED');
  }
  await q(`UPDATE swap_requests SET status='cancelled', reviewed_by=$2, reviewed_at=now() WHERE id=$1`,
    [swap.id, req.user.id]);
  await notify(req.user.org_id, [swap.to_user_id], 'swap',
    `${req.user.first_name} ${req.user.last_name} retiró la propuesta de cambio`, null, '/app/mis-turnos');
  audit(req, 'swap.cancelled', 'swap_request', swap.id);
  res.json({ ok: true });
}));

// Aprobación por el gestor: valida reglas del receptor y reasigna el turno
swapsRouter.post('/:id/approve', requireRole('manager'), asyncH(async (req, res) => {
  const swap = await loadSwap(req);
  if (swap.status !== 'accepted') {
    throw new HttpError(409, 'El cambio debe estar aceptado por la persona receptora antes de aprobarse', 'NOT_ACCEPTED');
  }
  const shift = await fetchScoped('shifts', swap.shift_id, req.user.org_id);
  if (shift.user_id !== swap.from_user_id) {
    throw new HttpError(409, 'El turno ya no pertenece a la persona que lo ofrece', 'CHANGED');
  }
  const target = await fetchScoped('users', swap.to_user_id, req.user.org_id);
  if (!target.is_active) throw new HttpError(400, 'La persona receptora está desactivada', 'INACTIVE');

  const rules = await rulesForOrg(req.user.org_id);
  const ws = weekStart(shift.date);
  const around = await shiftsAround(req.user.org_id, ws);
  const violations = checkShiftRules({
    rules, user: target, weekStart: ws,
    candidate: { ...shift, user_id: target.id },
    existingShifts: around.map((s) => ({ ...s, ws })),
    excludeShiftId: shift.id,
  });
  if (violations.length) {
    return res.status(422).json({ error: 'El cambio incumple las reglas de planificación', violations, code: 'RULES' });
  }

  await withTx(async (tx) => {
    await tx.query(`UPDATE shifts SET user_id=$2, updated_at=now() WHERE id=$1 AND user_id=$3`,
      [shift.id, target.id, swap.from_user_id]);
    await tx.query(`UPDATE swap_requests SET status='approved', reviewed_by=$2, reviewed_at=now() WHERE id=$1`,
      [swap.id, req.user.id]);
  });
  await notify(req.user.org_id, [swap.from_user_id, swap.to_user_id], 'swap',
    `Cambio de turno aprobado`, `${shift.date} · ${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}`,
    '/app/mis-turnos');
  audit(req, 'swap.approved', 'swap_request', swap.id, { shift: shift.id, to: target.id });
  res.json({ ok: true });
}));

swapsRouter.post('/:id/reject', requireRole('manager'), asyncH(async (req, res) => {
  const swap = await loadSwap(req);
  if (!['pending', 'accepted'].includes(swap.status)) {
    throw new HttpError(409, 'Esta propuesta ya fue gestionada', 'REVIEWED');
  }
  await q(`UPDATE swap_requests SET status='rejected', reviewed_by=$2, reviewed_at=now() WHERE id=$1`,
    [swap.id, req.user.id]);
  await notify(req.user.org_id, [swap.from_user_id, swap.to_user_id], 'swap',
    `Cambio de turno rechazado por el gestor`, null, '/app/mis-turnos');
  audit(req, 'swap.rejected', 'swap_request', swap.id);
  res.json({ ok: true });
}));
