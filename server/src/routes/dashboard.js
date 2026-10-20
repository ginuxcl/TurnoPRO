import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncH } from '../middleware/errors.js';
import { weekStart, addDays, todayStr, shiftDurationMinutes } from '../utils/time.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/', asyncH(async (req, res) => {
  const ws = weekStart(todayStr());
  const we = addDays(ws, 6);
  const isManager = req.user.role !== 'employee';

  const myWeek = await q(
    `SELECT date, start_time, end_time, break_minutes FROM shifts
      WHERE org_id = $1 AND user_id = $2 AND date BETWEEN $3 AND $4`,
    [req.user.org_id, req.user.id, ws, we]
  );
  const myMinutes = myWeek.rows.reduce(
    (acc, s) => acc + shiftDurationMinutes(s.start_time.slice(0, 5), s.end_time.slice(0, 5), s.break_minutes), 0
  );

  const upcoming = await q(
    `SELECT sh.date, sh.start_time, sh.end_time, sh.break_minutes, d.name AS department_name, d.color AS department_color,
            s.status AS schedule_status
       FROM shifts sh JOIN schedules s ON s.id = sh.schedule_id
       LEFT JOIN departments d ON d.id = sh.department_id
      WHERE sh.org_id = $1 AND sh.user_id = $2 AND sh.date >= $3 AND s.status = 'published'
      ORDER BY sh.date, sh.start_time LIMIT 5`,
    [req.user.org_id, req.user.id, todayStr()]
  );

  const myPending = await q(
    `SELECT
       (SELECT count(*) FROM leave_requests WHERE user_id=$1 AND status='pending') AS leave,
       (SELECT count(*) FROM shift_claims WHERE user_id=$1 AND status='pending') AS claims`,
    [req.user.id]
  );

  const base = {
    week_start: ws,
    my_shifts_this_week: myWeek.rows.length,
    my_minutes_this_week: myMinutes,
    weekly_hours_target: req.user.weekly_hours,
    upcoming: upcoming.rows,
    my_pending: myPending.rows[0],
  };

  if (!isManager) return res.json(base);

  // Métricas de gestión
  const openShifts = await q(
    `SELECT count(*) AS n FROM shifts sh JOIN schedules s ON s.id = sh.schedule_id
      WHERE sh.org_id = $1 AND sh.user_id IS NULL AND s.status='published' AND sh.date >= $2`,
    [req.user.org_id, todayStr()]
  );
  const pendingCounts = await q(
    `SELECT
       (SELECT count(*) FROM leave_requests WHERE org_id=$1 AND status='pending') AS leave,
       (SELECT count(*) FROM shift_claims WHERE org_id=$1 AND status='pending') AS claims`,
    [req.user.org_id]
  );
  const weekShifts = await q(
    `SELECT count(*) FILTER (WHERE user_id IS NOT NULL) AS assigned, count(*) AS total
       FROM shifts WHERE org_id = $1 AND date BETWEEN $2 AND $3`,
    [req.user.org_id, ws, we]
  );
  const todayRows = await q(
    `SELECT sh.start_time, sh.end_time, u.first_name, u.last_name, u.color, d.name AS department_name
       FROM shifts sh
       LEFT JOIN users u ON u.id = sh.user_id
       LEFT JOIN departments d ON d.id = sh.department_id
      WHERE sh.org_id = $1 AND sh.date = $2
      ORDER BY sh.start_time`,
    [req.user.org_id, todayStr()]
  );
  const activeStaff = await q(
    `SELECT count(*) AS n FROM users WHERE org_id = $1 AND is_active`,
    [req.user.org_id]
  );
  // Proacción: huecos de la semana que viene (borrador o publicado)
  const nextWeekOpen = await q(
    `SELECT count(*)::int AS n FROM shifts sh JOIN schedules s ON s.id = sh.schedule_id
      WHERE sh.org_id = $1 AND sh.user_id IS NULL AND sh.date BETWEEN $2 AND $3
        AND s.status IN ('draft','published')`,
    [req.user.org_id, addDays(ws, 7), addDays(ws, 13)]
  );
  // Sobrecarga: personas que superan su tope semanal en la semana que viene
  const overload = await q(
    `WITH nw AS (
       SELECT sh.user_id, sum(
         (CASE WHEN sh.end_time >= sh.start_time
            THEN (split_part(sh.end_time::text,':',1)::int*60 + split_part(sh.end_time::text,':',2)::int)
               - (split_part(sh.start_time::text,':',1)::int*60 + split_part(sh.start_time::text,':',2)::int)
            ELSE 1440
               - (split_part(sh.start_time::text,':',1)::int*60 + split_part(sh.start_time::text,':',2)::int)
               + (split_part(sh.end_time::text,':',1)::int*60 + split_part(sh.end_time::text,':',2)::int) END)
         - sh.break_minutes) AS mins
       FROM shifts sh JOIN schedules s ON s.id = sh.schedule_id
        WHERE sh.org_id = $1 AND sh.user_id IS NOT NULL AND s.status IN ('draft','published')
          AND sh.date BETWEEN $2 AND $3
       GROUP BY sh.user_id
     )
     SELECT u.first_name || ' ' || u.last_name AS name, nw.mins, u.weekly_hours
       FROM nw JOIN users u ON u.id = nw.user_id
      WHERE nw.mins > u.weekly_hours * 60`,
    [req.user.org_id, addDays(ws, 7), addDays(ws, 13)]
  );

  res.json({
    ...base,
    open_shifts: Number(openShifts.rows[0].n),
    pending: pendingCounts.rows[0],
    week_total_shifts: Number(weekShifts.rows[0].total),
    week_assigned_shifts: Number(weekShifts.rows[0].assigned),
    today_shifts: todayRows.rows,
    active_staff: Number(activeStaff.rows[0].n),
    next_week_open: Number(nextWeekOpen.rows[0].n),
    next_week_overload: overload.rows,
  });
}));
