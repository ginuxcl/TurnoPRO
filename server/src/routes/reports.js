import { Router } from 'express';
import ExcelJS from 'exceljs';
import { q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncH } from '../middleware/errors.js';
import { isValidDate, addDays, weekStart, todayStr } from '../utils/time.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireRole('manager'));

// Minutos planificados de un turno, soportando turnos que cruzan medianoche
const MIN_OF = (col) => `(split_part(${col}::text,':',1)::int*60 + split_part(${col}::text,':',2)::int)`;
const PLANNED_MIN = `
  ( CASE WHEN sh.end_time >= sh.start_time
      THEN ${MIN_OF('sh.end_time')} - ${MIN_OF('sh.start_time')}
      ELSE ${MIN_OF('sh.end_time')} - ${MIN_OF('sh.start_time')} + 1440 END )
  - COALESCE(sh.break_minutes, 0)`;

function rangeParams(req) {
  const today = todayStr();
  const monthAgo = addDays(today, -30);
  let from = isValidDate(req.query.from) ? req.query.from : monthAgo;
  let to = isValidDate(req.query.to) ? req.query.to : addDays(weekStart(today), 6);
  if (from > to) [from, to] = [to, from];
  const dep = /^[0-9a-f-]{36}$/.test(req.query.department_id || '') ? req.query.department_id : null;
  return { from, to, dep };
}

const depFilter = (dep) => (dep ? `AND sh.department_id = $4` : '');

// Resumen de horas y costes por persona
reportsRouter.get('/hours', asyncH(async (req, res) => {
  const { from, to, dep } = rangeParams(req);
  const params = dep ? [req.user.org_id, from, to, dep] : [req.user.org_id, from, to];
  const { rows } = await q(
    `SELECT u.id, u.first_name, u.last_name, u.position, u.color,
            u.weekly_hours, u.hourly_rate,
            count(sh.id) AS shift_count,
            COALESCE(sum((${PLANNED_MIN})) FILTER (WHERE sh.id IS NOT NULL), 0) AS planned_minutes,
            COALESCE(json_agg(json_build_object('name', d.name, 'color', d.color, 'minutes', ${PLANNED_MIN}))
                     FILTER (WHERE sh.id IS NOT NULL), '[]') AS by_department
       FROM users u
       LEFT JOIN shifts sh ON sh.user_id = u.id AND sh.date BETWEEN $2 AND $3 ${depFilter(dep)}
       LEFT JOIN departments d ON d.id = sh.department_id
      WHERE u.org_id = $1 AND u.is_active = TRUE
      GROUP BY u.id
      ORDER BY u.first_name`,
    params
  );
  // Minutos reales fichados en el mismo rango
  const actual = await q(
    `SELECT user_id, COALESCE(sum(EXTRACT(EPOCH FROM (clock_out - clock_in))/60), 0) AS minutes
       FROM time_entries WHERE org_id = $1 AND work_date BETWEEN $2 AND $3 AND clock_out IS NOT NULL
      GROUP BY user_id`,
    [req.user.org_id, from, to]
  );
  const actualMap = new Map(actual.rows.map((r) => [r.user_id, Number(r.minutes)]));
  const people = rows.map((r) => ({
    ...r,
    planned_minutes: Number(r.planned_minutes),
    actual_minutes: Math.round(actualMap.get(r.id) || 0),
    cost: r.hourly_rate != null ? Math.round((Number(r.planned_minutes) / 60) * Number(r.hourly_rate) * 100) / 100 : null,
  }));
  const totals = {
    shift_count: people.reduce((a, p) => a + Number(p.shift_count), 0),
    planned_minutes: people.reduce((a, p) => a + p.planned_minutes, 0),
    actual_minutes: people.reduce((a, p) => a + p.actual_minutes, 0),
    cost: people.reduce((a, p) => a + (p.cost || 0), 0),
  };
  res.json({ from, to, people, totals });
}));

// Exportación Excel profesional (Turnyon: colores por departamento, totales, resumen)
reportsRouter.get('/export.xlsx', asyncH(async (req, res) => {
  const { from, to, dep } = rangeParams(req);
  const params = dep ? [req.user.org_id, from, to, dep] : [req.user.org_id, from, to];
  const { rows: shifts } = await q(
    `SELECT sh.date, sh.start_time, sh.end_time, sh.break_minutes,
            u.first_name || ' ' || u.last_name AS person, u.hourly_rate,
            d.name AS department, d.color AS department_color,
            sh.notes AS template
       FROM shifts sh
       LEFT JOIN users u ON u.id = sh.user_id
       LEFT JOIN departments d ON d.id = sh.department_id
      WHERE sh.org_id = $1 AND sh.date BETWEEN $2 AND $3 ${depFilter(dep)} AND sh.user_id IS NOT NULL
      ORDER BY sh.date, sh.start_time`,
    params
  );
  const { rows: people } = await q(
    `SELECT u.first_name || ' ' || u.last_name AS person, u.position, u.hourly_rate, u.weekly_hours,
            count(sh.id) AS shift_count,
            COALESCE(sum(${PLANNED_MIN}), 0) AS planned_minutes
       FROM users u
       LEFT JOIN shifts sh ON sh.user_id = u.id AND sh.date BETWEEN $2 AND $3 ${depFilter(dep)}
      WHERE u.org_id = $1 AND u.is_active = TRUE
      GROUP BY u.id ORDER BY u.first_name`,
    params
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = 'TurnoPro';
  wb.created = new Date();

  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const shiftMinutes = (s) => {
    let d = toMin(s.end_time) - toMin(s.start_time);
    if (d < 0) d += 1440;
    return d - (s.break_minutes || 0);
  };

  // ---- Hoja 1: cuadrante con colores por departamento ----
  const ws = wb.addWorksheet('Turnos', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Fecha', key: 'date', width: 12 },
    { header: 'Día', key: 'day', width: 10 },
    { header: 'Persona', key: 'person', width: 24 },
    { header: 'Departamento', key: 'department', width: 18 },
    { header: 'Turno', key: 'template', width: 18 },
    { header: 'Inicio', key: 'start', width: 8 },
    { header: 'Fin', key: 'end', width: 8 },
    { header: 'Pausa (min)', key: 'break', width: 12 },
    { header: 'Horas', key: 'hours', width: 9 },
    { header: 'Coste (€)', key: 'cost', width: 11 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  head.alignment = { vertical: 'middle' };
  const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  for (const s of shifts) {
    const dt = new Date(`${s.date}T12:00:00`);
    const hours = Math.round((shiftMinutes(s) / 60) * 100) / 100;
    const row = ws.addRow({
      date: s.date, day: days[(dt.getDay() + 6) % 7], person: s.person,
      department: s.department || '—', template: s.template || '—',
      start: s.start_time, end: s.end_time, break: s.break_minutes || 0, hours,
      cost: s.hourly_rate != null ? Math.round(hours * Number(s.hourly_rate) * 100) / 100 : null,
    });
    const color = (s.department_color || '#64748b').replace('#', 'FF');
    row.getCell('department').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    row.getCell('department').font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };
  }
  if (shifts.length) {
    const totalHours = Math.round((shifts.reduce((a, s) => a + shiftMinutes(s), 0) / 60) * 100) / 100;
    const totalCost = Math.round(shifts.reduce((a, s) => a + (s.hourly_rate != null ? (shiftMinutes(s) / 60) * Number(s.hourly_rate) : 0), 0) * 100) / 100;
    const tr = ws.addRow({ person: 'TOTAL', hours: totalHours, cost: totalCost });
    tr.font = { bold: true };
    tr.getCell('person').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  }

  // ---- Hoja 2: resumen por persona ----
  const ws2 = wb.addWorksheet('Resumen', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws2.columns = [
    { header: 'Persona', key: 'person', width: 24 },
    { header: 'Puesto', key: 'position', width: 18 },
    { header: 'Turnos', key: 'count', width: 9 },
    { header: 'Horas planificadas', key: 'hours', width: 18 },
    { header: 'Jornada semanal', key: 'weekly', width: 16 },
    { header: 'Valor hora (€)', key: 'rate', width: 14 },
    { header: 'Coste (€)', key: 'cost', width: 12 },
  ];
  const head2 = ws2.getRow(1);
  head2.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  let sumHours = 0, sumCost = 0;
  for (const p of people) {
    const hours = Math.round((Number(p.planned_minutes) / 60) * 100) / 100;
    const cost = p.hourly_rate != null ? Math.round(hours * Number(p.hourly_rate) * 100) / 100 : null;
    sumHours += hours; sumCost += cost || 0;
    ws2.addRow({
      person: p.person, position: p.position || '—', count: Number(p.shift_count),
      hours, weekly: p.weekly_hours,
      rate: p.hourly_rate != null ? Number(p.hourly_rate) : null, cost,
    });
  }
  const tr2 = ws2.addRow({ person: 'TOTAL', hours: Math.round(sumHours * 100) / 100, cost: Math.round(sumCost * 100) / 100 });
  tr2.font = { bold: true };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="turnos_${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
}));
