import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncH } from '../middleware/errors.js';
import { fetchScoped } from '../middleware/scope.js';
import { isValidDate, isValidTime, addDays, weekStart, todayStr } from '../utils/time.js';
import { rulesForOrg, checkShiftRules, shiftsAround } from '../utils/rules.js';
import { audit } from '../middleware/audit.js';
import { notify } from '../utils/notify.js';
import { norm, DOW, parseDate, shiftsInRange, fmtShift } from './assistant.js';

// ============================================================================
// Comandos del cuadrante (estilo Deputy): el gestor pide en lenguaje natural,
// el sistema propone cambios y NADA se aplica sin revisión previa.
// ============================================================================

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fmtMin = (m) => {
  const mm = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
};
const absInterval = (x) => {
  const s = toMin(x.start_time);
  let e = toMin(x.end_time);
  if (e <= s) e += 1440;
  const day = Math.floor(Date.parse(`${x.date}T00:00:00Z`) / 60000);
  return [day + s, day + e];
};
const overlaps = (a, b) => {
  const [s1, e1] = absInterval(a);
  const [s2, e2] = absInterval(b);
  return s1 < e2 && s2 < e1;
};

const HELP_COMMANDS = [
  'Desde el cuadrante puedo preparar cambios que revisas antes de aplicar:',
  '• «Extiende los turnos de cocina del viernes una hora y pon nota refuerzo»',
  '• «Busca sustituto para Ana esta semana»',
  '• «Ana no está disponible los lunes hasta el 2026-12-31»',
  '• «¿Quién está trabajando ahora?» · «¿Está listo para la nómina?»',
].join('\n');

const commandSchema = z.object({
  question: z.string().trim().min(1).max(300),
  week_start: z.string().refine(isValidDate, 'Fecha inválida').optional(),
});

async function findPerson(orgId, t) {
  const tokens = t.split(/\s+/).filter((w) => w.length > 2);
  const staff = (await q(`SELECT id, first_name, last_name FROM users WHERE org_id = $1 AND is_active`, [orgId])).rows;
  return staff.find((p) => tokens.some((w) => norm(p.first_name).startsWith(w) || norm(p.last_name).startsWith(w))) || null;
}

async function findDept(orgId, t) {
  const deps = (await q(`SELECT id, name FROM departments WHERE org_id = $1`, [orgId])).rows;
  return deps.find((d) => t.includes(norm(d.name))) || null;
}

function rangeFor(t, weekStartStr) {
  const parsed = parseDate(t);
  if (parsed) return parsed;
  const ws = isValidDate(weekStartStr) ? weekStartStr : weekStart(todayStr());
  return { from: ws, to: addDays(ws, 6), label: 'esta semana' };
}

export const commandRouter = Router();
commandRouter.use(requireAuth);

// Analiza el comando y devuelve una vista previa (nunca aplica nada)
commandRouter.post('/command', requireRole('manager'), asyncH(async (req, res) => {
  const { question, week_start } = commandSchema.parse(req.body);
  const t = norm(question);
  const orgId = req.user.org_id;

  // --- ¿Listo para la nómina? (solo lectura) ---
  if (t.includes('nomina') || t.includes('cuadran')) {
    const { from, to, label } = rangeFor(t, week_start);
    const planned = await shiftsInRange(orgId, from, to, false);
    const entries = (await q(
      `SELECT te.*, EXTRACT(EPOCH FROM (clock_out - clock_in))/60 AS worked
         FROM time_entries te WHERE org_id = $1 AND work_date BETWEEN $2 AND $3`,
      [orgId, from, to]
    )).rows;
    const issues = [];
    for (const e of entries) {
      if (!e.clock_out) {
        issues.push(`⏳ ${e.work_date}: hay un fichaje aún en curso.`);
        continue;
      }
      const shift = planned.find((s) => s.user_id === e.user_id && s.date === e.work_date);
      if (shift) {
        const plannedMin = (toMin(shift.end_time) - toMin(shift.start_time) + (shift.end_time <= shift.start_time ? 1440 : 0));
        if (Math.abs(Number(e.worked) - plannedMin) > 15) {
          issues.push(`⚠️ ${e.work_date}: ${shift.person} fichó ${Math.floor(Number(e.worked) / 60)} h ${Math.round(Number(e.worked) % 60)} min vs. ${Math.floor(plannedMin / 60)} h planificadas.`);
        }
      }
    }
    for (const s of planned.filter((x) => x.user_id)) {
      if (!entries.some((e) => e.user_id === s.user_id && e.work_date === s.date)) {
        issues.push(`📝 ${s.date}: ${s.person} no ha fichado su turno de ${fmtShift(s)}.`);
      }
    }
    const answer = issues.length
      ? `Revisión para nómina ${label} — ${issues.length} incidencia(s):\n` + issues.slice(0, 12).join('\n') + (issues.length > 12 ? `\n… y ${issues.length - 12} más.` : '')
      : `✅ Todo cuadra ${label}: los fichajes coinciden con lo planificado (±15 min).`;
    return res.json({ kind: 'answer', answer });
  }

  // --- ¿Quién está ahora en turno? (solo lectura) ---
  if (t.includes('ahora')) {
    const today = todayStr();
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const rows = await shiftsInRange(orgId, today, today, false);
    const on = rows.filter((s) => s.user_id && toMin(s.start_time) <= nowMin && nowMin < toMin(s.end_time) + (s.end_time <= s.start_time ? 1440 : 0));
    const answer = on.length
      ? `🟢 Ahora mismo en turno (${fmtMin(nowMin)}):\n` + on.map((s) => `  • ${s.person} · ${fmtShift(s)}${s.department ? ` (${s.department})` : ''}`).join('\n')
      : 'Nadie está de turno en este momento.';
    return res.json({ kind: 'answer', answer });
  }

  // --- Extender turnos ---
  if (/extiend|extend|alarga|prolong|aumenta/.test(t)) {
    const { from, to, label } = rangeFor(t, week_start);
    const hours = Number(t.match(/(\d+)\s*hora/)?.[1]) || 1;
    const dept = await findDept(orgId, t);
    const person = await findPerson(orgId, t);
    const note = question.match(/nota[:\s]+([\s\S]{1,120})/i)?.[1]?.trim() || null;
    const conds = ['sh.org_id = $1', 'sh.date BETWEEN $2 AND $3', 'sh.user_id IS NOT NULL'];
    const params = [orgId, from, to];
    if (dept) { params.push(dept.id); conds.push(`sh.department_id = $${params.length}`); }
    if (person) { params.push(person.id); conds.push(`sh.user_id = $${params.length}`); }
    const rows = (await q(
      `SELECT sh.*, u.first_name || ' ' || u.last_name AS person
         FROM shifts sh LEFT JOIN users u ON u.id = sh.user_id
        WHERE ${conds.join(' AND ')}
        ORDER BY sh.date, sh.start_time`,
      params
    )).rows;
    const changes = rows.map((sh) => {
      const newEnd = fmtMin(toMin(sh.end_time.slice(0, 5)) + hours * 60);
      return {
        type: 'extend_shift', shift_id: sh.id, end_time: newEnd, note,
        label: `${sh.date} · ${sh.person}: ${sh.start_time.slice(0, 5)}–${sh.end_time.slice(0, 5)} → hasta ${newEnd}`,
      };
    });
    if (!changes.length) {
      return res.json({ kind: 'answer', answer: `No encontré turnos que extender ${label}${dept ? ` en ${dept.name}` : ''}.` });
    }
    return res.json({
      kind: 'preview',
      summary: `Extender ${changes.length} turno(s) ${hours} h ${label}${dept ? ` (${dept.name})` : ''}${person ? ` de ${person.first_name}` : ''}${note ? ` con nota «${note}»` : ''}.`,
      changes,
    });
  }

  // --- Buscar sustituto ---
  if (/sustitut|reemplaz|cubrir|sustituir|cambiale|cámbiale/.test(t)) {
    const person = await findPerson(orgId, t);
    if (!person) return res.json({ kind: 'answer', answer: '¿De quién busco sustituto? Menciona su nombre, p. ej. «busca sustituto para Ana esta semana».' });
    const { from, to, label } = rangeFor(t, week_start);
    const theirShifts = (await q(
      `SELECT * FROM shifts WHERE org_id = $1 AND user_id = $2 AND date BETWEEN $3 AND $4 ORDER BY date, start_time`,
      [orgId, person.id, from, to]
    )).rows;
    if (!theirShifts.length) return res.json({ kind: 'answer', answer: `${person.first_name} no tiene turnos ${label}.` });

    const rules = await rulesForOrg(orgId);
    const around = await shiftsAround(orgId, weekStart(from));
    const leaveRows = (await q(`SELECT user_id, start_date, end_date FROM leave_requests WHERE org_id = $1 AND status = 'approved'`, [orgId])).rows;
    const prefRows = (await q(`SELECT user_id, blocked_dates FROM preferences WHERE org_id = $1`, [orgId])).rows;
    const blockedOf = (uid) => prefRows.find((r) => r.user_id === uid)?.blocked_dates || [];
    const staff = (await q(`SELECT id, first_name, last_name, weekly_hours FROM users WHERE org_id = $1 AND is_active AND id != $2`, [orgId, person.id])).rows;

    const changes = [];
    let sinSustituto = 0;
    for (const sh of theirShifts) {
      const cand = [];
      for (const p of staff) {
        if (leaveRows.some((l) => l.user_id === p.id && sh.date >= l.start_date && sh.date <= l.end_date)) continue;
        if (blockedOf(p.id).includes(sh.date)) continue;
        if (around.some((o) => o.user_id === p.id && overlaps(sh, o))) continue;
        const v = checkShiftRules({
          rules, user: p, weekStart: weekStart(from),
          candidate: { user_id: p.id, date: sh.date, start_time: sh.start_time.slice(0, 5), end_time: sh.end_time.slice(0, 5), break_minutes: sh.break_minutes },
          existingShifts: around,
        });
        if (!v.length) cand.push(p);
      }
      if (!cand.length) { sinSustituto++; continue; }
      cand.sort((a, b) => (a.weekly_hours - b.weekly_hours) || a.id.localeCompare(b.id));
      changes.push({
        type: 'reassign', shift_id: sh.id, to_user_id: cand[0].id,
        label: `${sh.date} · ${sh.start_time.slice(0, 5)}–${sh.end_time.slice(0, 5)}: ${person.first_name} ${person.last_name} → ${cand[0].first_name} ${cand[0].last_name}`,
      });
    }
    if (!changes.length) {
      return res.json({ kind: 'answer', answer: `No encontré sustitutos válidos para los turnos de ${person.first_name} ${label}: las reglas, ausencias o disponibilidad lo impiden.` });
    }
    return res.json({
      kind: 'preview',
      summary: `Sustituir ${changes.length} turno(s) de ${person.first_name} ${label}` + (sinSustituto ? ` — ${sinSustituto} turno(s) sin candidato válido quedarían como están.` : '.'),
      changes,
    });
  }

  // --- No disponible / bloquear días ---
  if (/no (?:esta )?disponible|no puede|no podra|bloquea|indisponib/.test(t)) {
    const person = await findPerson(orgId, t);
    if (!person) return res.json({ kind: 'answer', answer: '¿Para quién? Menciona el nombre, p. ej. «Ana no está disponible los lunes hasta el 2026-12-31».' });
    const dows = DOW.map((d, i) => (t.includes(d) ? i : -1)).filter((i) => i >= 0);
    if (!dows.length) return res.json({ kind: 'answer', answer: `¿Qué días? Indícalos, p. ej. «${person.first_name} no está disponible los lunes y martes hasta el 2026-12-31».` });
    const untilMatch = t.match(/hasta (?:el )?(\d{4}-\d{2}-\d{2})/);
    const until = untilMatch && isValidDate(untilMatch[1]) ? untilMatch[1] : addDays(todayStr(), 28);
    const dates = [];
    let cursor = todayStr();
    while (cursor <= until && dates.length < 60) {
      const dowIdx = (new Date(`${cursor}T12:00:00`).getDay() + 6) % 7;
      if (dows.includes(dowIdx)) dates.push(cursor);
      cursor = addDays(cursor, 1);
    }
    if (!dates.length) return res.json({ kind: 'answer', answer: 'La fecha «hasta» ya pasó o no quedan días por bloquear.' });
    return res.json({
      kind: 'preview',
      summary: `Bloquear ${dates.length} día(s) (${dows.map((d) => DOW[d]).join(', ')}) para ${person.first_name} ${person.last_name} hasta el ${until}. El autocompletado los respetará.`,
      changes: [{
        type: 'block_dates', user_id: person.id, dates,
        label: `${person.first_name} ${person.last_name}: sin trabajar los ${dows.map((d) => DOW[d]).join(' y ')} hasta el ${until}`,
      }],
    });
  }

  return res.json({ kind: 'answer', answer: HELP_COMMANDS });
}));

// Aplicar los cambios ya revisados. Cada cambio se revalida en servidor
// (ámbito por organización, reglas, solapes y ausencias).
const changeSchema = z.object({
  type: z.enum(['extend_shift', 'reassign', 'block_dates']),
  shift_id: z.string().uuid().optional(),
  to_user_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  end_time: z.string().refine(isValidTime, 'Hora inválida').optional(),
  note: z.string().trim().max(120).optional().nullable(),
  dates: z.array(z.string().refine(isValidDate)).max(60).optional(),
  label: z.string().max(200).optional(),
});

commandRouter.post('/apply', requireRole('manager'), asyncH(async (req, res) => {
  const parsed = z.object({ changes: z.array(changeSchema).min(1).max(80) }).parse(req.body);
  const orgId = req.user.org_id;
  const rules = await rulesForOrg(orgId);
  let applied = 0;
  const failed = [];
  const touched = new Set();

  for (const c of parsed.changes) {
    try {
      if (c.type === 'extend_shift') {
        if (!c.shift_id || !c.end_time) throw new Error('Datos incompletos');
        const sh = await fetchScoped('shifts', c.shift_id, orgId);
        if (!sh.user_id) throw new Error('El turno está abierto');
        const user = (await q(`SELECT first_name, weekly_hours FROM users WHERE id = $1 AND org_id = $2`, [sh.user_id, orgId])).rows[0];
        const around = await shiftsAround(orgId, weekStart(sh.date));
        const v = checkShiftRules({
          rules, user, weekStart: weekStart(sh.date),
          candidate: { user_id: sh.user_id, date: sh.date, start_time: sh.start_time.slice(0, 5), end_time: c.end_time, break_minutes: sh.break_minutes },
          existingShifts: around, excludeShiftId: sh.id,
        });
        if (v.length) throw new Error(v[0]);
        await q(
          `UPDATE shifts SET end_time = $2, notes = CASE WHEN $3::text IS NOT NULL THEN trim(COALESCE(notes, '') || ' ' || $3) ELSE notes END, updated_at = now() WHERE id = $1`,
          [sh.id, c.end_time, c.note ?? null]
        );
        touched.add(sh.user_id);
        applied++;
      } else if (c.type === 'reassign') {
        if (!c.shift_id || !c.to_user_id) throw new Error('Datos incompletos');
        const sh = await fetchScoped('shifts', c.shift_id, orgId);
        const target = (await q(`SELECT id, first_name, weekly_hours FROM users WHERE id = $1 AND org_id = $2 AND is_active`, [c.to_user_id, orgId])).rows[0];
        if (!target) throw new Error('La persona no pertenece a tu organización');
        if (sh.user_id === target.id) throw new Error('Ya es su turno');
        const around = await shiftsAround(orgId, weekStart(sh.date));
        const cand = { user_id: target.id, date: sh.date, start_time: sh.start_time.slice(0, 5), end_time: sh.end_time.slice(0, 5), break_minutes: sh.break_minutes };
        if (around.some((o) => o.id !== sh.id && o.user_id === target.id && overlaps(sh, o))) throw new Error('Ya tiene un turno que se solapa');
        const v = checkShiftRules({ rules, user: target, weekStart: weekStart(sh.date), candidate: cand, existingShifts: around, excludeShiftId: sh.id });
        if (v.length) throw new Error(v[0]);
        await q(`UPDATE shifts SET user_id = $2, updated_at = now() WHERE id = $1`, [sh.id, target.id]);
        touched.add(target.id);
        applied++;
      } else if (c.type === 'block_dates') {
        if (!c.user_id || !c.dates?.length) throw new Error('Datos incompletos');
        const u = await q(`SELECT id FROM users WHERE id = $1 AND org_id = $2`, [c.user_id, orgId]);
        if (!u.rows[0]) throw new Error('La persona no pertenece a tu organización');
        const existing = (await q(`SELECT blocked_dates FROM preferences WHERE user_id = $1`, [c.user_id])).rows[0]?.blocked_dates || [];
        const merged = [...new Set([...existing, ...c.dates])].sort().slice(0, 90);
        await q(
          `INSERT INTO preferences (user_id, org_id, blocked_dates) VALUES ($1,$2,$3)
           ON CONFLICT (user_id) DO UPDATE SET blocked_dates = EXCLUDED.blocked_dates, updated_at = now()`,
          [c.user_id, orgId, JSON.stringify(merged)]
        );
        applied++;
      }
    } catch (e) {
      failed.push({ label: c.label || c.type, reason: e.message });
    }
  }

  audit(req, 'assistant.applied', 'assistant', null, { applied, failed: failed.length });
  if (touched.size) {
    notify(orgId, [...touched], 'schedule', '🗓 Cambio en tu cuadrante', 'Tu gestor actualizó algunos de tus turnos', '/app/mis-turnos').catch(() => {});
  }
  res.json({ applied, failed });
}));
