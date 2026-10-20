import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncH, HttpError } from '../middleware/errors.js';
import { fetchScoped } from '../middleware/scope.js';
import { isValidDate, isValidTime, addDays, weekStart, todayStr } from '../utils/time.js';
import { rulesForOrg, checkShiftRules, shiftsAround } from '../utils/rules.js';
import { audit } from '../middleware/audit.js';
import { notify } from '../utils/notify.js';

export const assistantRouter = Router();
assistantRouter.use(requireAuth);

const schema = z.object({ question: z.string().trim().min(1).max(300) });

export const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const DOW = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

// Devuelve {from,to,label} o null
export function parseDate(text) {
  const t = norm(text);
  const today = todayStr();
  const iso = t.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso && isValidDate(iso[1])) return { from: iso[1], to: iso[1], label: iso[1] };
  if (t.includes('pasado manana')) return { from: addDays(today, 2), to: addDays(today, 2), label: 'pasado mañana' };
  if (t.includes('manana')) return { from: addDays(today, 1), to: addDays(today, 1), label: 'mañana' };
  if (t.includes('ayer')) return { from: addDays(today, -1), to: addDays(today, -1), label: 'ayer' };
  if (t.includes('hoy')) return { from: today, to: today, label: 'hoy' };
  for (const [i, d] of DOW.entries()) {
    if (new RegExp(`\\b${d}`).test(t)) {
      const ws = weekStart(today);
      let target = addDays(ws, i);
      if (target < today) target = addDays(target, 7); // próxima ocurrencia
      return { from: target, to: target, label: `el ${d}` };
    }
  }
  if (t.includes('semana que viene') || t.includes('proxima semana')) {
    return { from: addDays(weekStart(today), 7), to: addDays(weekStart(today), 13), label: 'la semana que viene' };
  }
  if (t.includes('esta semana')) return { from: weekStart(today), to: addDays(weekStart(today), 6), label: 'esta semana' };
  if (t.includes('este mes') || t.includes('mes')) {
    const [y, m] = today.split('-').map(Number);
    return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: today, label: 'este mes' };
  }
  return null;
}

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fmtShift = (s) => `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`;

export async function shiftsInRange(orgId, from, to, employeeOnly) {
  return (await q(
    `SELECT sh.date, sh.start_time, sh.end_time, sh.user_id,
            u.first_name || ' ' || u.last_name AS person, d.name AS department
       FROM shifts sh
       JOIN schedules sc ON sc.id = sh.schedule_id
       LEFT JOIN users u ON u.id = sh.user_id
       LEFT JOIN departments d ON d.id = sh.department_id
      WHERE sh.org_id = $1 AND sh.date BETWEEN $2 AND $3 ${employeeOnly ? `AND sc.status = 'published'` : ''}
      ORDER BY sh.date, sh.start_time`,
    [orgId, from, to]
  )).rows;
}

const HELP = [
  'Puedo responder cosas como:',
  '• «¿Quién trabaja mañana?» o «¿quién trabaja el viernes?»',
  '• «¿Quién está libre el martes?»',
  '• «Turnos abiertos esta semana»',
  '• «Horas de Ana esta semana» / «mis horas este mes»',
  '• «Coste de esta semana» (gestores)',
  '• «Ausencias pendientes»',
].join('\n');

assistantRouter.post('/query', asyncH(async (req, res) => {
  const { question } = schema.parse(req.body);
  const t = norm(question);
  const isManager = req.user.role !== 'employee';
  const orgId = req.user.org_id;
  let answer = null;

  // 0. ¿Quién está en turno ahora mismo?
  if (t.includes('ahora')) {
    const today = todayStr();
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const rows = await shiftsInRange(orgId, today, today, !isManager);
    const on = rows.filter((s) => s.user_id && toMin(s.start_time) <= nowMin && nowMin < toMin(s.end_time) + (s.end_time <= s.start_time ? 1440 : 0));
    answer = on.length
      ? `🟢 Ahora mismo en turno:\n` + on.map((s) => `  • ${s.person} · ${fmtShift(s)}${s.department ? ` (${s.department})` : ''}`).join('\n')
      : 'Nadie está de turno en este momento.';
  }
  // 1. ¿Quién trabaja…?
  if (t.includes('trabaja') || t.includes('trabajan') || t.includes('quien va')) {
    const range = parseDate(t) || parseDate('hoy');
    const rows = await shiftsInRange(orgId, range.from, range.to, !isManager);
    const assigned = rows.filter((s) => s.user_id);
    const open = rows.filter((s) => !s.user_id);
    const byDate = {};
    for (const s of assigned) (byDate[s.date] ||= []).push(s);
    const lines = Object.entries(byDate).map(([date, list]) =>
      `📅 ${date}:\n` + list.map((s) => `  • ${s.person} · ${fmtShift(s)}${s.department ? ` (${s.department})` : ''}`).join('\n')
    );
    answer = lines.length
      ? lines.join('\n') + (open.length ? `\n\n🔓 Además hay ${open.length} turno(s) abierto(s) sin asignar.` : '')
      : `No hay nadie asignado ${range.label}.` + (open.length ? ` Hay ${open.length} turno(s) abierto(s).` : '');
  }

  // 2. ¿Quién está libre…?
  else if (t.includes('libre') || t.includes('descansa') || t.includes('no trabaja')) {
    const range = parseDate(t) || parseDate('hoy');
    const working = await shiftsInRange(orgId, range.from, range.from, !isManager);
    const busy = new Set(working.filter((s) => s.user_id).map((s) => s.user_id));
    const staff = (await q(`SELECT id, first_name, last_name FROM users WHERE org_id = $1 AND is_active`, [orgId])).rows;
    const free = staff.filter((p) => !busy.has(p.id)).map((p) => `${p.first_name} ${p.last_name}`);
    answer = free.length
      ? `${range.label === 'hoy' ? 'Hoy' : range.label.charAt(0).toUpperCase() + range.label.slice(1)} descansan: ${free.join(', ')}.`
      : `Todo el equipo trabaja ${range.label}.`;
  }

  // 3. Turnos abiertos
  else if (t.includes('abierto') || t.includes('hueco') || t.includes('vacante') || t.includes('sin asignar')) {
    const today = todayStr();
    const rows = (await q(
      `SELECT sh.date, sh.start_time, sh.end_time, d.name AS department, sc.status
         FROM shifts sh JOIN schedules sc ON sc.id = sh.schedule_id
         LEFT JOIN departments d ON d.id = sh.department_id
        WHERE sh.org_id = $1 AND sh.user_id IS NULL AND sh.date BETWEEN $2 AND $3
          AND ($4 OR sc.status = 'published')
        ORDER BY sh.date, sh.start_time LIMIT 20`,
      [orgId, today, addDays(today, 14), isManager]
    )).rows;
    answer = rows.length
      ? `🔓 ${rows.length} turno(s) abierto(s) en los próximos 14 días:\n` +
        rows.map((s) => `  • ${s.date} · ${fmtShift(s)}${s.department ? ` (${s.department})` : ''}`).join('\n') +
        `\nPuedes reclamarlos desde «Mis turnos».`
      : 'No hay turnos abiertos en los próximos 14 días. 🎉';
  }

  // 4. Horas de una persona
  else if (t.includes('hora')) {
    const range = parseDate(t) || parseDate('esta semana');
    const stop = new RegExp(`\\b(ha[sz]ta|de|del|la|el|en|esta|este|semana|mes|hoy|mañana|ayer)\\b`, 'g');
    const tokens = norm(question).replace(stop, ' ').split(/\s+/).filter((w) => w.length > 2);
    const staff = (await q(`SELECT id, first_name, last_name FROM users WHERE org_id = $1 AND is_active`, [orgId])).rows;
    let person = null;
    if (t.includes('mi ') || t.includes('mis')) person = staff.find((p) => p.id === req.user.id);
    if (!person) {
      person = staff.find((p) => tokens.some((w) => norm(p.first_name).startsWith(w) || norm(p.last_name).startsWith(w)));
    }
    if (!person) {
      answer = '¿De quién? Dime un nombre, por ejemplo «horas de Ana esta semana».';
    } else if (!isManager && person.id !== req.user.id) {
      answer = 'Solo puedes consultar tus propias horas. 🙂';
    } else {
      const rows = await shiftsInRange(orgId, range.from, range.to, !isManager);
      const mine = rows.filter((s) => s.user_id === person.id);
      const mins = mine.reduce((a, s) => {
        const [sh, sm] = s.start_time.split(':').map(Number);
        const [eh, em] = s.end_time.split(':').map(Number);
        let d = eh * 60 + em - (sh * 60 + sm);
        if (d <= 0) d += 1440;
        return a + d;
      }, 0);
      const name = person.id === req.user.id ? 'Tienes' : `${person.first_name} ${person.last_name} tiene`;
      answer = `${name} ${mine.length} turno(s) y ${Math.floor(mins / 60)} h ${mins % 60 ? `${mins % 60} min` : ''} ${range.label}.`;
    }
  }

  // 5. Coste (solo gestores)
  else if (t.includes('coste') || t.includes('gasto') || t.includes('cuesta')) {
    if (!isManager) {
      answer = 'Los costes solo los pueden consultar los gestores.';
    } else {
      const range = parseDate(t) || parseDate('esta semana');
      const r = (await q(
        `SELECT COALESCE(sum(
           ((CASE WHEN sh.end_time >= sh.start_time
              THEN (split_part(sh.end_time::text,':',1)::int*60 + split_part(sh.end_time::text,':',2)::int)
                 - (split_part(sh.start_time::text,':',1)::int*60 + split_part(sh.start_time::text,':',2)::int)
              ELSE 1440
                 - (split_part(sh.start_time::text,':',1)::int*60 + split_part(sh.start_time::text,':',2)::int)
                 + (split_part(sh.end_time::text,':',1)::int*60 + split_part(sh.end_time::text,':',2)::int) END)
           - sh.break_minutes) * COALESCE(u.hourly_rate, 0) / 60.0), 0) AS cost
         FROM shifts sh JOIN users u ON u.id = sh.user_id
        WHERE sh.org_id = $1 AND sh.date BETWEEN $2 AND $3`,
        [orgId, range.from, range.to]
      )).rows[0];
      answer = `💰 Coste estimado ${range.label}: ${Math.round(Number(r.cost)).toLocaleString('es-ES')} € (según valor hora). Detalles en «Reportes».`;
    }
  }

  // 6. Ausencias / pendientes
  else if (t.includes('ausencia') || t.includes('permiso') || t.includes('vacacion') || t.includes('pendiente') || t.includes('solicitud')) {
    if (isManager) {
      const p = (await q(
        `SELECT
           (SELECT count(*) FROM leave_requests WHERE org_id = $1 AND status = 'pending') AS leave,
           (SELECT count(*) FROM shift_claims WHERE org_id = $1 AND status = 'pending') AS claims,
           (SELECT count(*) FROM swap_requests WHERE org_id = $1 AND status IN ('pending','accepted')) AS swaps`,
        [orgId]
      )).rows[0];
      answer = `✉️ Pendientes de revisar: ${p.leave} ausencia(s), ${p.claims} reclamación(es) y ${p.swaps} cambio(s) de turno. Revísalos en «Solicitudes».`;
    } else {
      const p = (await q(
        `SELECT
           (SELECT count(*) FROM leave_requests WHERE org_id = $1 AND user_id = $2 AND status = 'pending') AS leave,
           (SELECT count(*) FROM shift_claims WHERE org_id = $1 AND user_id = $2 AND status = 'pending') AS claims,
           (SELECT count(*) FROM swap_requests WHERE org_id = $1 AND (from_user_id = $2 OR to_user_id = $2) AND status = 'pending') AS swaps`,
        [orgId, req.user.id]
      )).rows[0];
      answer = `✉️ Tus solicitudes en curso: ${p.leave} ausencia(s), ${p.claims} reclamación(es) y ${p.swaps} cambio(s).`;
    }
  }

  if (!answer) answer = HELP;
  audit(req, 'assistant.query', 'assistant', null, { q: question.slice(0, 120) });
  res.json({ answer });
}));

