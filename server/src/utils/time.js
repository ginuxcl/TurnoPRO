// Utilidades de fecha/hora. Todo se maneja como fecha local "naive"
// (YYYY-MM-DD y HH:MM) para evitar errores de zona horaria entre cliente y servidor.

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function fromMinutes(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Duración en minutos de un turno; soporta turnos que cruzan medianoche (end < start)
export function shiftDurationMinutes(start, end, breakMinutes) {
  const s = toMinutes(start);
  const e = toMinutes(end);
  let d = e - s;
  if (d <= 0) d += 1440; // cruza medianoche
  return Math.max(0, d - (breakMinutes || 0));
}

// Lunes de la semana de una fecha YYYY-MM-DD
export function weekStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0=domingo
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDate(s) {
  if (!DATE_RE.test(s || '')) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isValidTime(s) {
  return TIME_RE.test(s || '');
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
