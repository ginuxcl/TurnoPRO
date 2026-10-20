import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncH, HttpError } from '../middleware/errors.js';
import { fetchScoped, assertOwnerOrManager } from '../middleware/scope.js';
import { isValidDate } from '../utils/time.js';
import { audit } from '../middleware/audit.js';
import { notify, managerIds } from '../utils/notify.js';

export const leaveRouter = Router();
leaveRouter.use(requireAuth);

const schema = z.object({
  type: z.enum(['vacation', 'sick', 'personal', 'other']),
  start_date: z.string().refine(isValidDate, 'Fecha inválida'),
  end_date: z.string().refine(isValidDate, 'Fecha inválida'),
  reason: z.string().trim().max(300).optional().nullable(),
}).refine((d) => d.start_date <= d.end_date, {
  message: 'La fecha de fin debe ser posterior a la de inicio',
});

// Crear solicitud propia
leaveRouter.post('/', asyncH(async (req, res) => {
  const d = schema.parse(req.body);
  const { rows } = await q(
    `INSERT INTO leave_requests (org_id, user_id, type, start_date, end_date, reason)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.user.org_id, req.user.id, d.type, d.start_date, d.end_date, d.reason ?? null]
  );
  audit(req, 'leave.created', 'leave_request', rows[0].id, { type: d.type });
  await notify(req.user.org_id, await managerIds(req.user.org_id), 'leave',
    `${req.user.first_name} ${req.user.last_name} solicitó una ausencia`,
    `${d.start_date} → ${d.end_date}`, '/app/solicitudes');
  res.status(201).json({ request: rows[0] });
}));

// Listar: empleado ve las suyas; manager ve todas (filtro ?user_id)
leaveRouter.get('/', asyncH(async (req, res) => {
  const params = [req.user.org_id];
  let userCond = '';
  if (req.user.role === 'employee' || req.query.user_id === 'me') {
    userCond = 'AND l.user_id = $2';
    params.push(req.user.id);
  } else if (req.query.user_id && /^[0-9a-fA-F-]{36}$/.test(req.query.user_id)) {
    userCond = `AND l.user_id = $${params.length + 1}`;
    params.push(req.query.user_id);
  }
  const statusCond = req.query.status && ['pending', 'approved', 'rejected'].includes(req.query.status)
    ? `AND l.status = '${req.query.status}'` : '';
  const { rows } = await q(
    `SELECT l.*, u.first_name || ' ' || u.last_name AS user_name, u.color AS user_color
       FROM leave_requests l JOIN users u ON u.id = l.user_id
      WHERE l.org_id = $1 ${userCond} ${statusCond}
      ORDER BY l.created_at DESC LIMIT 200`,
    params
  );
  res.json({ requests: rows });
}));

// Impacto de cobertura si se aprueba la ausencia (vista previa para el gestor)
leaveRouter.get('/:id/impact', requireRole('manager'), asyncH(async (req, res) => {
  const leave = await fetchScoped('leave_requests', req.params.id, req.user.org_id);
  const person = (await q(
    `SELECT first_name || ' ' || last_name AS name FROM users WHERE id = $1`,
    [leave.user_id]
  )).rows[0];

  const affected = (await q(
    `SELECT sh.id, sh.date, sh.start_time, sh.end_time, sh.department_id,
            d.name AS department_name, d.color AS department_color, sc.status AS schedule_status
       FROM shifts sh
       LEFT JOIN departments d ON d.id = sh.department_id
       JOIN schedules sc ON sc.id = sh.schedule_id
      WHERE sh.org_id = $1 AND sh.user_id = $2 AND sh.date BETWEEN $3 AND $4
      ORDER BY sh.date, sh.start_time`,
    [req.user.org_id, leave.user_id, leave.start_date, leave.end_date]
  )).rows;

  // Cobertura por día y departamento afectado: cuántos quedan después de liberar
  const dates = [...new Set(affected.map((s) => s.date))];
  const byDate = [];
  const warnings = [];
  for (const date of dates) {
    const depts = [...new Set(affected.filter((s) => s.date === date).map((s) => s.department_id).filter(Boolean))];
    const dayEntries = [];
    for (const depId of depts) {
      const dep = affected.find((s) => s.department_id === depId);
      const others = (await q(
        `SELECT count(DISTINCT user_id)::int AS n FROM shifts
          WHERE org_id = $1 AND date = $2 AND department_id = $3 AND user_id IS NOT NULL AND user_id != $4`,
        [req.user.org_id, date, depId, leave.user_id]
      )).rows[0].n;
      dayEntries.push({ department: dep.department_name, color: dep.department_color, remaining: others });
      if (others === 0) {
        warnings.push(`El ${date} nadie más cubriría ${dep.department_name}.`);
      }
    }
    byDate.push({ date, departments: dayEntries });
  }

  res.json({
    leave: { id: leave.id, start_date: leave.start_date, end_date: leave.end_date, type: leave.type, person: person?.name },
    shifts: affected,
    by_date: byDate,
    warnings,
  });
}));

// Revisar (aprobar/rechazar) — manager
leaveRouter.post('/:id/review', requireRole('manager'), asyncH(async (req, res) => {
  const leave = await fetchScoped('leave_requests', req.params.id, req.user.org_id);
  if (leave.status !== 'pending') throw new HttpError(409, 'Esta solicitud ya fue revisada', 'REVIEWED');
  const { status } = z.object({ status: z.enum(['approved', 'rejected']) }).parse(req.body);

  await q(
    `UPDATE leave_requests SET status=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1`,
    [leave.id, status, req.user.id]
  );
  if (status === 'approved') {
    // Desasignar turnos publicados/asignados dentro del periodo de ausencia
    const unassigned = await q(
      `UPDATE shifts SET user_id = NULL, updated_at = now()
        WHERE org_id = $1 AND user_id = $2 AND date BETWEEN $3 AND $4 RETURNING id`,
      [req.user.org_id, leave.user_id, leave.start_date, leave.end_date]
    );
    if (unassigned.rows.length) {
      await q(
        `UPDATE shift_claims SET status='cancelled', reviewed_at=now()
          WHERE shift_id = ANY($1::uuid[]) AND status='pending' AND user_id = $2`,
        [unassigned.rows.map((r) => r.id), leave.user_id]
      );
    }
  }
  audit(req, `leave.${status}`, 'leave_request', leave.id, { user: leave.user_id });
  await notify(req.user.org_id, [leave.user_id], 'leave',
    status === 'approved' ? 'Tu solicitud de ausencia fue aprobada ✅' : 'Tu solicitud de ausencia fue rechazada',
    `${leave.start_date} → ${leave.end_date}`, '/app/solicitudes');
  res.json({ ok: true });
}));

// Cancelar la propia solicitud pendiente
leaveRouter.post('/:id/cancel', asyncH(async (req, res) => {
  const leave = await fetchScoped('leave_requests', req.params.id, req.user.org_id);
  assertOwnerOrManager(req, leave.user_id);
  if (leave.status !== 'pending') throw new HttpError(409, 'Solo puedes cancelar solicitudes pendientes', 'REVIEWED');
  await q(`UPDATE leave_requests SET status='rejected', reviewed_by=$2, reviewed_at=now() WHERE id=$1`,
    [leave.id, req.user.id]);
  audit(req, 'leave.cancelled', 'leave_request', leave.id);
  res.json({ ok: true });
}));
