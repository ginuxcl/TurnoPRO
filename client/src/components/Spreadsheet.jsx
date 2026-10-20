import { useMemo } from 'react';
import { DAY_SHORT, dow, durationMin, addDays, todayStr, t5 } from '../ui.jsx';

/**
 * Vista tipo hoja de cálculo: filas = personas, columnas = días.
 * - shifts: turnos de la semana (con user_name, user_color, department_color…)
 * - onShiftClick(shift) / onCellClick(date, userId)
 */
export default function Spreadsheet({ weekStart, shifts, staff, onShiftClick, onCellClick }) {
  const today = todayStr();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const byPerson = useMemo(() => {
    const map = new Map();
    for (const s of shifts) {
      if (!s.user_id) continue;
      if (!map.has(s.user_id)) map.set(s.user_id, []);
      map.get(s.user_id).push(s);
    }
    return map;
  }, [shifts]);

  const openByDay = useMemo(() => {
    const map = {};
    for (const s of shifts) if (!s.user_id) (map[s.date] ||= []).push(s);
    return map;
  }, [shifts]);

  const rows = staff.filter((p) => p.is_active);

  const minsOf = (list) => list.reduce((a, s) => a + durationMin(t5(s.start_time), t5(s.end_time), s.break_minutes), 0);
  const hrs = (m) => `${Math.round((m / 60) * 10) / 10} h`;

  return (
    <div className="card ss-wrap">
      <table className="ss-grid">
        <thead>
          <tr>
            <th className="ss-corner">Persona</th>
            {days.map((d) => (
              <th key={d} className={`${dow(d) >= 5 ? 'weekend' : ''} ${d === today ? 'today' : ''}`}>
                <div className="ss-dn">{DAY_SHORT[dow(d)]}</div>
                <div className="ss-dm">{Number(d.slice(8))}</div>
              </th>
            ))}
            <th className="ss-total">Semana</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const list = byPerson.get(p.id) || [];
            const total = minsOf(list);
            return (
              <tr key={p.id}>
                <th className="ss-person">
                  <span className="dot" style={{ background: p.color }} />
                  <span className="ss-name">{p.first_name} {p.last_name}</span>
                  <span className="muted ss-pos">{p.position || ''}</span>
                </th>
                {days.map((d) => {
                  const cell = list.filter((s) => s.date === d).sort((a, b) => a.start_time.localeCompare(b.start_time));
                  return (
                    <td
                      key={d}
                      className={`${dow(d) >= 5 ? 'weekend' : ''} ${d === today ? 'today' : ''} ${cell.length ? 'filled' : 'empty'}`}
                      onClick={cell.length === 0 ? () => onCellClick(d, p.id) : undefined}
                      title={cell.length === 0 ? `Añadir turno a ${p.first_name} el ${d}` : undefined}
                    >
                      {cell.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="ss-chip"
                          style={{ borderColor: s.department_color || s.user_color || '#6366f1' }}
                          onClick={(e) => { e.stopPropagation(); onShiftClick(s); }}
                          title={`${t5(s.start_time)}–${t5(s.end_time)} · ${s.department_name || ''}`}
                        >
                          <i style={{ background: s.department_color || s.user_color || '#6366f1' }} />
                          {t5(s.start_time)}–{t5(s.end_time)}
                        </button>
                      ))}
                    </td>
                  );
                })}
                <td className="ss-total">{list.length ? <span className="badge badge-sky">{hrs(total)}</span> : <span className="muted">—</span>}</td>
              </tr>
            );
          })}
          <tr className="ss-open-row">
            <th className="ss-person">🔓 Abiertos</th>
            {days.map((d) => {
              const cell = openByDay[d] || [];
              return (
                <td key={d} className={`${dow(d) >= 5 ? 'weekend' : ''} ${cell.length ? 'filled' : 'empty'}`}
                  onClick={cell.length === 0 ? () => onCellClick(d, null) : undefined}>
                  {cell.map((s) => (
                    <button key={s.id} type="button" className="ss-chip open" onClick={(e) => { e.stopPropagation(); onShiftClick(s); }}
                      title={`Turno abierto ${t5(s.start_time)}–${t5(s.end_time)}`}>
                      <i style={{ background: '#fb923c' }} />
                      {t5(s.start_time)}–{t5(s.end_time)}
                    </button>
                  ))}
                </td>
              );
            })}
            <td className="ss-total"><span className="badge badge-amber">{shifts.filter((s) => !s.user_id).length}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
