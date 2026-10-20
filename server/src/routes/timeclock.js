import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncH, HttpError } from '../middleware/errors.js';
import { fetchScoped } from '../middleware/scope.js';
import { isValidDate } from '../utils/time.js';
import { audit } from '../middleware/audit.js';

export const timeclockRouter = Router();
timeclockRouter.use(requireAuth);

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function minsBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 60000);
}

// Estado actual: fichaje abierto + turno asignado de hoy (para el botón grande)
timeclockRouter.get('/status', asyncH(async (req, res) => {
  const open = await q(
    `SELECT * FROM time_entries WHERE user_id = $1 AND clock_out IS NULL`,
    [req.user.id]
  );
  const today = todayStr();
  const { rows } = await q(
    `SELECT sh.id, sh.date, sh.start_time, sh.end_time, sh.notes AS template_name
       FROM shifts sh
      WHERE sh.org_id = $1 AND sh.user_id = $2 AND sh.date = $3`,
    [req.user.org_id, req.user.id, today]
  );
  res.json({
    active: open.rows[0]
      ? { id: open.rows[0].id, clock_in: open.rows[0].clock_in }
      : null,
    today_shift: rows[0] || null,
    today,
  });
}));

// Fichar entrada/salida (un clic)
timeclockRouter.post('/clock', asyncH(async (req, res) => {
  const open = await q(
    `SELECT * FROM time_entries WHERE user_id = $1 AND clock_out IS NULL`,
    [req.user.id]
  );
  if (open.rows[0]) {
    const inAt = new Date(open.rows[0].clock_in);
    const outAt = new Date();
    if (outAt - inAt < 1000) throw new HttpError(429, 'Espera un momento antes de fichar de nuevo', 'TOO_FAST');
    const { rows } = await q(
      `UPDATE time_entries SET clock_out = $2 WHERE id = $1 RETURNING *`,
      [open.rows[0].id, outAt]
    );
    audit(req, 'timeclock.out', 'time_entry', rows[0].id, { minutes: minsBetween(inAt, outAt) });
    return res.json({ action: 'out', entry: rows[0] });
  }
  const { rows } = await q(
    `INSERT INTO time_entries (org_id, user_id, work_date, clock_in) VALUES ($1,$2,$3,now()) RETURNING *`,
    [req.user.org_id, req.user.id, todayStr()]
  );
  audit(req, 'timeclock.in', 'time_entry', rows[0].id);
  res.json({ action: 'in', entry: rows[0] });
}));

// Mi historial de fichajes
timeclockRouter.get('/me', asyncH(async (req, res) => {
  const from = isValidDate(req.query.from) ? req.query.from : null;
  const to = isValidDate(req.query.to) ? req.query.to : null;
  const { rows } = await q(
    `SELECT * FROM time_entries WHERE user_id = $1
       AND ($2::date IS NULL OR work_date >= $2) AND ($3::date IS NULL OR work_date <= $3)
      ORDER BY work_date DESC, clock_in DESC LIMIT 120`,
    [req.user.id, from, to]
  );
  res.json({ entries: rows });
}));

// Panel planificado vs. real de un día (solo gestores)
timeclockRouter.get('/panel', requireRole('manager'), asyncH(async (req, res) => {
  const date = isValidDate(req.query.date) ? req.query.date : todayStr();
  const shifts = await q(
    `SELECT sh.id, sh.date, sh.start_time, sh.end_time, sh.notes, sh.break_minutes, sh.user_id,
            u.first_name || ' ' || u.last_name AS user_name, u.color,
            d.name AS department_name
       FROM shifts sh
       LEFT JOIN users u ON u.id = sh.user_id
       LEFT JOIN departments d ON d.id = sh.department_id
      WHERE sh.org_id = $1 AND sh.date = $2 AND sh.user_id IS NOT NULL
      ORDER BY sh.start_time`,
    [req.user.org_id, date]
  );
  const entries = await q(
    `SELECT te.* FROM time_entries te
      WHERE te.org_id = $1 AND te.work_date = $2
      ORDER BY te.clock_in`,
    [req.user.org_id, date]
  );
  const byUser = new Map(entries.rows.map((e) => [e.user_id, e]));
  const rows = shifts.rows.map((s) => {
    const e = byUser.get(s.user_id) || null;
    const toMin = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
    let late = null, leftEarly = null, extra = null;
    if (e && e.clock_in) {
      const actualIn = new Date(e.clock_in);
      const planned = new Date(`${date}T${s.start_time}:00`);
      const diff = Math.round((actualIn - planned) / 60000);
      if (diff > 5) late = diff;
      if (e.clock_out) {
        const actualOut = new Date(e.clock_out);
        const plannedOut = new Date(`${date}T${s.end_time}:00`);
        const diffOut = Math.round((plannedOut - actualOut) / 60000);
        if (diffOut > 5) leftEarly = diffOut;
        if (actualOut - plannedOut > 5 * 60000) extra = Math.round((actualOut - plannedOut) / 60000);
      }
    }
    return { ...s, entry: e, late_minutes: late, left_early_minutes: leftEarly, extra_minutes: extra };
  });
  res.json({ date, rows });
}));

// Alta manual de fichaje (correcciones de RRHH, solo gestores)
const manualSchema = z.object({
  user_id: z.string().uuid(),
  work_date: z.string().refine(isValidDate, 'Fecha inválida'),
  clock_in: z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida'),
  clock_out: z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida'),
  note: z.string().trim().max(200).optional().nullable(),
});

timeclockRouter.post('/', requireRole('manager'), asyncH(async (req, res) => {
  const d = manualSchema.parse(req.body);
  // Anti-IDOR: la persona debe pertenecer a la organización del gestor
  const u = await q(`SELECT id FROM users WHERE id = $1 AND org_id = $2`, [d.user_id, req.user.org_id]);
  if (!u.rows[0]) throw new HttpError(404, 'Persona no encontrada', 'NOT_FOUND');
  if (d.clock_out <= d.clock_in) throw new HttpError(400, 'La salida debe ser posterior a la entrada', 'BAD_RANGE');
  const { rows } = await q(
    `INSERT INTO time_entries (org_id, user_id, work_date, clock_in, clock_out, source, note, created_by)
     VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz,'manual',$6,$7) RETURNING *`,
    [req.user.org_id, d.user_id, d.work_date, `${d.work_date} ${d.clock_in}`, `${d.work_date} ${d.clock_out}`, d.note ?? null, req.user.id]
  );
  audit(req, 'timeclock.manual', 'time_entry', rows[0].id, { user_id: d.user_id, work_date: d.work_date });
  res.status(201).json({ entry: rows[0] });
}));

timeclockRouter.delete('/:id', requireRole('manager'), asyncH(async (req, res) => {
  const entry = await fetchScoped('time_entries', req.params.id, req.user.org_id);
  await q(`DELETE FROM time_entries WHERE id = $1`, [entry.id]);
  audit(req, 'timeclock.deleted', 'time_entry', entry.id);
  res.json({ ok: true });
}));
