import { useMemo, useState } from 'react';
import { DAY_SHORT, dow, durationMin, fmtDate, todayStr, t5 } from '../ui.jsx';

const PX_PER_HOUR = 56;

// Rango visible del calendario según los turnos (con margen 7:00–24:00 por defecto)
function rangeFor(shifts) {
  let min = 8 * 60, max = 23 * 60;
  for (const s of shifts) {
    const [sh, sm] = s.start_time.split(':').map(Number);
    min = Math.min(min, sh * 60 + sm);
    const endM = durationMin(s.start_time, s.end_time, 0) + sh * 60 + sm;
    max = Math.max(max, Math.min(endM, 24 * 60));
  }
  return { start: Math.floor(min / 60), end: Math.max(Math.ceil(max / 60), Math.floor(min / 60) + 6) };
}

// Distribuye los turnos de un día: agrupa los que se solapan en "racimos" y
// asigna carriles dentro de cada racimo. Los turnos sin solape ocupan todo el ancho.
function layoutDay(dayShifts) {
  const items = dayShifts.map((s) => {
    const start = Number(s.start_time.slice(0, 2)) * 60 + Number(s.start_time.slice(3, 5));
    return { ...s, _start: start, _end: start + durationMin(s.start_time, s.end_time, 0), _lanes: 1 };
  }).sort((a, b) => a._start - b._start);

  const clusters = [];
  let cur = null;
  for (const it of items) {
    if (!cur || it._start >= cur._end) {
      cur = { items: [], _end: 0 };
      clusters.push(cur);
    }
    cur.items.push(it);
    cur._end = Math.max(cur._end, it._end);
  }
  for (const cl of clusters) {
    const laneEnds = [];
    for (const it of cl.items) {
      let lane = laneEnds.findIndex((end) => end <= it._start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(it._end);
      } else {
        laneEnds[lane] = it._end;
      }
      it.lane = lane;
      it._lanes = laneEnds.length;
    }
  }
  return items;
}

function fmtTime(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/* ---------- Rejilla mensual compacta ---------- */
function MonthGrid({ monthFrom, shifts, today, leaveByDate, holidaysByDate, onCellClick }) {
  const byDay = {};
  for (const s of shifts) (byDay[s.date] ||= []).push(s);

  const [y, m] = monthFrom.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startOffset = (first.getDay() + 6) % 7; // lunes = 0
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7 !== 0) cells.push(null);

  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  return (
    <div className="cal-month">
      {DAY_SHORT.map((d) => <div key={d} className="cm-head">{d}</div>)}
      {cells.map((date, i) => {
        if (!date) return <div key={`x${i}`} className="cm-cell dim" />;
        const list = (byDay[date] || []).sort((a, b) => a.start_time.localeCompare(b.start_time));
        const leaving = leaveByDate[date] || [];
        const holiday = holidaysByDate?.[date];
        const visible = list.slice(0, holiday ? 2 : 3);
        const isToday = date === today;
        return (
          <div
            key={date}
            className={`cm-cell ${isToday ? 'today' : ''} ${onCellClick ? 'clickable' : ''} ${i % 7 === 0 ? 'first' : ''} ${holiday ? 'holiday' : ''}`}
            onClick={onCellClick ? () => onCellClick(date) : undefined}
            style={i % 7 === 0 ? { borderLeft: 'none' } : undefined}
          >
            <span className="cm-daynum">{Number(date.slice(8))}</span>
            {holiday && <span className="cm-holiday" title={holiday}>🎉 {holiday}</span>}
            {leaving.slice(0, holiday ? 0 : 1).map((l, j) => <span key={`l${j}`} className="cm-leave">🌴 {l.name}</span>)}
            {visible.map((s) => {
              const open = !s.user_id;
              const color = open ? undefined : s.user_color || s.department_color || '#6366f1';
              return (
                <span key={s.id} className={`cm-shift ${open ? 'open' : ''}`} style={{ background: open ? undefined : color }}
                  title={`${s.start_time?.slice(0, 5)}–${s.end_time?.slice(0, 5)} · ${open ? 'Turno abierto' : s.user_name}`}>
                  {s.start_time?.slice(0, 5)} {open ? '🔓' : (s.user_name || '').split(' ')[0]}
                </span>
              );
            })}
            {list.length > 3 && <span className="cm-more">+{list.length - 3} más</span>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Calendario de turnos: modo semana (grid por horas) o modo mes.
 * - shifts: turnos con { id, date, start_time, end_time, break_minutes, user_name, user_color, department_name, user_id }
 * - onSlotClick(date, time) — clic en hueco (solo semana)
 * - onShiftClick(shift) — clic en turno
 * - onDropShift(shiftId, newDate) — mover turno arrastrando (si draggable, solo semana)
 * - leaveByDate: { 'YYYY-MM-DD': [{ name, color }] }
 * - mode: 'week' | 'month'; monthFrom: 'YYYY-MM-01' cuando mode='month'
 */
export default function Calendar({ weekStart, shifts, onSlotClick, onShiftClick, onDropShift, draggable = false, leaveByDate = {}, holidaysByDate = {}, mode = 'week', monthFrom, onMonthCellClick }) {
  const today = todayStr();
  const { start, end } = useMemo(() => rangeFor(shifts), [shifts]);
  const totalH = end - start;
  const [dragId, setDragId] = useState(null);
  const [dropDay, setDropDay] = useState(null);

  if (mode === 'month') {
    return <MonthGrid monthFrom={monthFrom} shifts={shifts} today={today} leaveByDate={leaveByDate} holidaysByDate={holidaysByDate} onCellClick={onMonthCellClick} />;
  }

  const hours = [];
  for (let h = start; h <= end; h++) hours.push(h);

  const days = Array.from({ length: 7 }, (_, i) => {
    const [y, m, d] = weekStart.split('-').map(Number);
    const dt = new Date(y, m - 1, d + i);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  });

  const byDay = {};
  for (const s of shifts) (byDay[s.date] ||= []).push(s);

  const handleDayClick = (e, date) => {
    if (!onSlotClick || dragId) return;
    if (e.target.closest('.shift-block')) return; // dejá el clic al bloque
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    let mins = start * 60 + Math.round((y / PX_PER_HOUR) * 60 / 30) * 30;
    mins = Math.max(start * 60, Math.min(mins, end * 60 - 60));
    onSlotClick(date, fmtTime(mins));
  };

  const handleDrop = (e, date) => {
    e.preventDefault();
    setDropDay(null);
    const id = e.dataTransfer.getData('text/shift-id') || dragId;
    if (id && onDropShift) onDropShift(id, date);
    setDragId(null);
  };

  return (
    <div className="cal">
      {/* Cabecera de días */}
      <div className="cal-corner" />
      {days.map((date) => {
        const cnt = (byDay[date] || []).length;
        const holiday = holidaysByDate[date];
        return (
          <div key={date} className={`cal-head ${date === today ? 'today' : ''} ${dow(date) >= 5 ? 'weekend' : ''} ${holiday ? 'holiday' : ''}`} title={holiday || undefined}>
            <div className="dn">{DAY_SHORT[dow(date)]} {fmtDate(date).split(' ')[0]}</div>
            <div className="dm">{Number(date.slice(8))}</div>
            <div className="dcount">{holiday ? `🎉 ${holiday}` : cnt ? `${cnt} turno${cnt > 1 ? 's' : ''}` : '—'}</div>
          </div>
        );
      })}

      {/* Cuerpo */}
      <div className="cal-body-wrap" style={{ height: totalH * PX_PER_HOUR }}>
        <div className="cal-hours">
          {hours.slice(0, -1).map((h) => (
            <div key={h} className="cal-hour-label" style={{ top: (h - start) * PX_PER_HOUR + 12 }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {days.map((date) => {
          const isWeekend = dow(date) >= 5;
          const leaving = leaveByDate[date] || [];
          const laidOut = layoutDay(byDay[date] || []);
          const gap = 3;
          return (
            <div
              key={date}
              className={`cal-day ${date === today ? 'today' : ''} ${isWeekend ? 'weekend' : ''} ${dropDay === date ? 'drop-target' : ''}`}
              onClick={(e) => handleDayClick(e, date)}
              onDragOver={(e) => { if (draggable && dragId) { e.preventDefault(); setDropDay(date); } }}
              onDragLeave={() => setDropDay((d) => (d === date ? null : d))}
              onDrop={(e) => handleDrop(e, date)}
            >
              {hours.slice(0, -1).map((h) => (
                <div key={h} className="hour-line" style={{ top: (h - start) * PX_PER_HOUR }} />
              ))}
              {leaving.map((l, i) => (
                <div key={i} className="badge badge-amber" style={{ position: 'absolute', top: 3 + i * 22, left: 4, right: 4, zIndex: 3, justifyContent: 'flex-start', fontSize: 10, padding: '2px 7px' }}>
                  🌴 {l.name}
                </div>
              ))}
              {laidOut.map((s) => {
                const [sh, sm] = s.start_time.split(':').map(Number);
                const startMin = sh * 60 + sm;
                const dur = durationMin(s.start_time, s.end_time, s.break_minutes);
                const topOff = ((startMin - start * 60) / 60) * PX_PER_HOUR;
                const height = Math.max(30, (dur / 60) * PX_PER_HOUR - 3);
                const open = !s.user_id;
                const mine = s.is_mine;
                const color = open ? '#fb923c' : s.user_color || (s.department_color || '#6366f1');
                const lanes = s._lanes;
                return (
                  <div
                    key={s.id}
                    className={`shift-block ${open ? 'open' : ''} ${mine ? 'mine' : ''} ${dragId === s.id ? 'dragging' : ''}`}
                    style={{
                      top: topOff, height,
                      width: `calc((100% - 8px - ${(lanes - 1) * gap}px) / ${lanes})`,
                      left: `calc(4px + ${s.lane} * ((100% - 8px + ${gap}px) / ${lanes}))`,
                      background: open ? undefined : `linear-gradient(135deg, ${color}, ${color}cc)`,
                    }}
                    title={`${t5(s.start_time)}–${t5(s.end_time)} · ${open ? 'Turno abierto' : s.user_name}${s.department_name ? ' · ' + s.department_name : ''}`}
                    onClick={(e) => { e.stopPropagation(); onShiftClick?.(s); }}
                    draggable={draggable}
                    onDragStart={(e) => { e.dataTransfer.setData('text/shift-id', s.id); e.dataTransfer.effectAllowed = 'move'; setDragId(s.id); }}
                    onDragEnd={() => setDragId(null)}
                  >
                    <div className="t"><span>{t5(s.start_time)}</span><span>{t5(s.end_time)}</span></div>
                    <div className="who">{open ? '🔓 Turno abierto' : s.user_name}</div>
                    {height > 52 && s.department_name && <div className="dep">{s.department_name}{s.break_minutes ? ` · ${s.break_minutes}m pausa` : ''}</div>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
