import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/* ---------- Logo ---------- */
export function Logo({ dark = false, small = false }) {
  return (
    <span className="logo">
      <span className="logo-mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
          <circle cx="12" cy="12" r="8.4" />
          <path d="M12 7.6v4.6l3.2 2.3" />
        </svg>
      </span>
      {!small && <span className="logo-name" style={dark ? { color: '#fff' } : undefined}>TurnoPro</span>}
    </span>
  );
}

/* ---------- Avatar con iniciales ---------- */
export function initials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}
export function Avatar({ name, color = '#6366f1', size = '' }) {
  return <span className={`avatar ${size}`} style={{ background: color }}>{initials(name)}</span>;
}

/* ---------- Fechas (siempre en horario local, sin conversiones) ---------- */
export const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const DAY_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// 'YYYY-MM-DD' → { y, m, d, dow } sin pasar por Date (evita desfases TZ)
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}
export function dow(s) {
  const { y, m, d } = parseDate(s);
  return (new Date(y, m - 1, d).getDay() + 6) % 7; // 0 = lunes
}
export function fmtDate(s) {
  const { y, m, d } = parseDate(s);
  return `${d} ${MONTHS[m - 1]}`;
}
export function fmtDateLong(s) {
  const { y, m, d } = parseDate(s);
  return `${DAY_NAMES[dow(s)]}, ${d} de ${MONTHS[m - 1]} de ${y}`;
}
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(s, n) {
  const { y, m, d } = parseDate(s);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
export function weekStart(s) {
  return addDays(s, -dow(s));
}
export function hoursLabel(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h} h`;
}
export function t5(t) { return (t || '').slice(0, 5); }
export function durationMin(start, end, brk) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let d = eh * 60 + em - (sh * 60 + sm);
  if (d <= 0) d += 1440;
  return Math.max(0, d - (brk || 0));
}

/* ---------- Modal ---------- */
export function Modal({ title, onClose, children, footer, width }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={width ? { maxWidth: width } : undefined}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Toasts ---------- */
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);
  const push = useCallback((msg, kind = 'ok') => {
    const id = ++idRef.current;
    setItems((xs) => [...xs, { id, msg, kind }]);
    setTimeout(() => setItems((xs) => xs.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- Spinner ---------- */
export function Spinner() { return <div className="spin" />; }

/* ---------- Badges de rol / estado ---------- */
export const ROLE_LABEL = { owner: 'Propietario', manager: 'Gestor', employee: 'Empleado' };
export const LEAVE_LABEL = { vacation: 'Vacaciones', sick: 'Baja médica', personal: 'Asunto personal', other: 'Otros' };
export const LEAVE_BADGE = { vacation: 'badge-sky', sick: 'badge-red', personal: 'badge-violet', other: 'badge-gray' };
export const STATUS_BADGE = { pending: ['Pendiente', 'badge-amber'], approved: ['Aprobada', 'badge-green'], rejected: ['Rechazada', 'badge-red'], cancelled: ['Cancelada', 'badge-gray'] };
