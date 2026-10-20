import { q } from '../db.js';
import { shiftDurationMinutes, addDays, weekStart as toWeekStart, toMinutes } from './time.js';

export const RULE_DEFAULTS = {
  max_shifts_per_day: 2,      // turnos máx. por persona y día (partidos permitidos)
  min_rest_hours: 8,          // descanso mínimo entre fin de turno e inicio del siguiente
  max_consecutive_days: 6,    // días seguidos máximos trabajando
  max_weekly_hours: null,     // tope duro semanal (si es null, se usa weekly_hours del empleado)
};

export async function rulesForOrg(orgId) {
  const { rows } = await q('SELECT rules FROM organizations WHERE id = $1', [orgId]);
  return { ...RULE_DEFAULTS, ...(rows[0]?.rules || {}) };
}

const absStart = (s) => toMinutes(s.start_time.slice(0, 5));
const absEnd = (s) => {
  const st = absStart(s);
  const en = toMinutes(s.end_time.slice(0, 5));
  return en <= st ? en + 1440 : en;
};
const dayDiff = (a, b) =>
  Math.round((new Date(`${a}T00:00Z`) - new Date(`${b}T00:00Z`)) / 86400000);

// Intervalo absoluto en minutos desde el lunes de la semana base
const absInterval = (s, weekStart) => {
  const d = dayDiff(s.date, weekStart);
  return [absStart(s) + d * 1440, absEnd(s) + d * 1440];
};

/**
 * Valida un turno candidato (o recién asignado) para una persona contra las reglas
 * de la organización, considerando sus turnos reales en [date-3, date+3].
 * Devuelve una lista de violaciones (vacía = cumple).
 */
export function checkShiftRules({ rules, user, weekStart, candidate, existingShifts, excludeShiftId }) {
  const v = [];
  const [candStart, candEnd] = absInterval(candidate, weekStart);
  const others = existingShifts
    .filter((s) => s.id !== excludeShiftId && s.user_id === candidate.user_id)
    .map((s) => ({ ...s, ws: toWeekStart(s.date) }));

  // 1. Turnos por día
  const sameDay = others.filter((s) => s.date === candidate.date);
  if (rules.max_shifts_per_day != null && sameDay.length >= rules.max_shifts_per_day) {
    v.push(`${user.first_name} ya tiene ${sameDay.length} turno(s) ese día (máx. ${rules.max_shifts_per_day}).`);
  }

  // 2. Descanso mínimo entre turnos
  for (const s of others) {
    const [os, oe] = absInterval(s, weekStart);
    if (candStart < oe && os < candEnd) continue; // solape real (ya lo bloquea el endpoint)
    const gap = candStart >= oe ? candStart - oe : os - candEnd;
    const gapH = Math.floor(gap / 60);
    if (gap < (rules.min_rest_hours ?? 0) * 60) {
      v.push(`Descanso insuficiente para ${user.first_name}: ${gapH} h entre el turno del ${s.date} y este (mín. ${rules.min_rest_hours} h).`);
    }
  }

  // 3. Días consecutivos
  const dates = new Set(others.map((s) => s.date));
  dates.add(candidate.date);
  let run = 1;
  for (let i = 1; i <= rules.max_consecutive_days; i++) { if (dates.has(addDays(candidate.date, -i))) run++; else break; }
  for (let i = 1; i <= rules.max_consecutive_days; i++) { if (dates.has(addDays(candidate.date, i))) run++; else break; }
  if (rules.max_consecutive_days != null && run > rules.max_consecutive_days) {
    v.push(`${user.first_name} acumularía ${run} días seguidos (máx. ${rules.max_consecutive_days}).`);
  }

  // 4. Tope de horas semanales
  const ws = toWeekStart(candidate.date);
  const cap = rules.max_weekly_hours ?? user.weekly_hours ?? 40;
  const weekMins = others
    .filter((s) => toWeekStart(s.date) === ws)
    .reduce((a, s) => a + shiftDurationMinutes(s.start_time.slice(0, 5), s.end_time.slice(0, 5), s.break_minutes), 0);
  const candMins = shiftDurationMinutes(candidate.start_time.slice(0, 5), candidate.end_time.slice(0, 5), candidate.break_minutes);
  if (weekMins + candMins > cap * 60) {
    v.push(`${user.first_name} superaría su tope semanal: ${Math.round((weekMins + candMins) / 60)} h > ${cap} h.`);
  }

  return v;
}

/**
 * Carga los turnos de una semana (+márgenes) ya proyectados a la semana base,
 * para pasarlos a checkShiftRules / autocompletado.
 */
export async function shiftsAround(orgId, weekStart, marginDays = 3) {
  const { rows } = await q(
    `SELECT id, date, start_time, end_time, break_minutes, user_id
       FROM shifts WHERE org_id = $1 AND date BETWEEN $2 AND $3 AND user_id IS NOT NULL`,
    [orgId, addDays(weekStart, -marginDays), addDays(weekStart, 6 + marginDays)]
  );
  return rows;
}
