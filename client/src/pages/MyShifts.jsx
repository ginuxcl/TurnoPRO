import { useCallback, useEffect, useMemo, useState } from 'react';
import { Topbar } from '../components/Layout.jsx';
import { get, post } from '../api.js';
import { Avatar, Modal, Spinner, DAY_NAMES, dow, fmtDateLong, hoursLabel, t5, useToast, durationMin, weekStart, addDays, todayStr } from '../ui.jsx';
import Calendar from '../components/Calendar.jsx';

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Modal: proponer ceder uno de mis turnos a un compañero
function SwapModal({ shift, staff, onClose, onDone }) {
  const toast = useToast();
  const [toUserId, setToUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const others = staff.filter((p) => p.is_active && p.id !== shift.user_id);

  const propose = async () => {
    setBusy(true);
    try {
      await post('/swaps', { shift_id: shift.id, to_user_id: toUserId });
      toast('Propuesta enviada — tu compañero debe aceptarla y el gestor aprobarla');
      onDone();
    } catch (e) {
      toast(e.message, 'err');
      setBusy(false);
    }
  };

  return (
    <Modal title="Proponer cambio de turno" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={propose} disabled={busy || !toUserId}>Enviar propuesta</button>
      </>}>
      <div className="card card-pad mb-14" style={{ background: 'var(--primary-softer)' }}>
        <span className="time-pill">{t5(shift.start_time)}–{t5(shift.end_time)}</span>
        <b> {fmtDateLong(shift.date)}</b>
        <div className="muted" style={{ fontSize: 12.5 }}>{shift.department_name || ''}</div>
      </div>
      <div className="field">
        <label>Ceder a…</label>
        <select className="input" value={toUserId} onChange={(e) => setToUserId(e.target.value)}>
          <option value="">— Elegir compañero —</option>
          {others.map((p) => <option key={p.id} value={p.id}>{p.first_name} {p.last_name} · {p.position || 'Personal'}</option>)}
        </select>
        <span className="hint">Tu compañero recibirá una notificación y deberá aceptar; después el gestor aprueba el cambio validando las reglas.</span>
      </div>
    </Modal>
  );
}

export default function MyShifts() {
  const toast = useToast();
  const [ws, setWs] = useState(weekStart(todayStr()));
  const [mode, setMode] = useState('week');
  const [monthRef, setMonthRef] = useState(todayStr().slice(0, 7));
  const [shifts, setShifts] = useState([]);
  const [openShifts, setOpenShifts] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(null);
  const [swapModal, setSwapModal] = useState(null);

  const range = useMemo(() => {
    if (mode === 'week') return { from: addDays(ws, -1), to: addDays(ws, 6) };
    const [y, m] = monthRef.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return { from: `${monthRef}-01`, to: `${monthRef}-${String(last).padStart(2, '0')}` };
  }, [mode, ws, monthRef]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mine, open, st] = await Promise.all([
        get(`/shifts?user_id=me&from=${range.from}&to=${range.to}`),
        get(`/shifts?user_id=open&from=${todayStr()}&to=${addDays(todayStr(), 21)}`),
        get('/staff'),
      ]);
      setShifts(mine.shifts);
      setOpenShifts(open.shifts);
      setStaff(st.staff);
    } catch (e) {
      toast(e.message, 'err');
    }
    setLoading(false);
  }, [range, toast]);

  useEffect(() => { load(); }, [load]);

  const claim = async (shiftId) => {
    setClaiming(shiftId);
    try {
      await post(`/shifts/${shiftId}/claim`);
      toast('Solicitud enviada — el gestor la revisará');
      load();
    } catch (e) {
      toast(e.message, 'err');
    }
    setClaiming(null);
  };

  const nav = (delta) => {
    if (mode === 'week') setWs((w) => addDays(w, delta * 7));
    else {
      const [y, m] = monthRef.split('-').map(Number);
      const d = new Date(y, m - 1 + delta, 1);
      setMonthRef(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
  };

  const myHours = shifts.reduce((a, s) => a + durationMin(t5(s.start_time), t5(s.end_time), s.break_minutes), 0);
  const grouped = useMemo(() => {
    const g = {};
    for (const s of shifts) (g[s.date] ||= []).push(s);
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
  }, [shifts]);

  const weekLabel = mode === 'week'
    ? `Semana del ${ws.slice(8)}/${ws.slice(5, 7)}`
    : (() => { const [y, m] = monthRef.split('-').map(Number); return `${MONTH_NAMES[m - 1][0].toUpperCase() + MONTH_NAMES[m - 1].slice(1)} ${y}`; })();

  return (
    <>
      <Topbar title="Mis turnos">
        <span className="badge badge-violet">{Math.round((myHours / 60) * 10) / 10} h{mode === 'week' ? ' esta semana' : ' este mes'}</span>
        <div className="tabs">
          <button className={`tab ${mode === 'week' ? 'active' : ''}`} onClick={() => setMode('week')}>Semana</button>
          <button className={`tab ${mode === 'month' ? 'active' : ''}`} onClick={() => setMode('month')}>Mes</button>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => { setWs(weekStart(todayStr())); setMonthRef(todayStr().slice(0, 7)); }}>Hoy</button>
      </Topbar>
      <div className="content">
        <div className="cal-toolbar">
          <div className="left">
            <button className="btn btn-ghost btn-icon" onClick={() => nav(-1)}>‹</button>
            <div className="week-label">
              {weekLabel}
              <small>Los turnos aparecen cuando tu gestor publica el horario</small>
            </div>
            <button className="btn btn-ghost btn-icon" onClick={() => nav(1)}>›</button>
          </div>
        </div>

        {loading ? <Spinner /> : (
          <>
            <Calendar
              weekStart={ws}
              monthFrom={`${monthRef}-01`}
              mode={mode}
              shifts={shifts.map((s) => ({ ...s, is_mine: true }))}
              onShiftClick={(s) => setSwapModal(s)}
              onMonthCellClick={undefined}
            />
            <p className="hint mt-14" style={{ textAlign: 'center' }}>
              Clic en uno de tus turnos para proponer cederlo a un compañero
            </p>

            {openShifts.length > 0 && (
              <div className="card card-pad mt-20">
                <div className="section-head">
                  <h3 className="card-title">🔓 Turnos abiertos que puedes reclamar</h3>
                  <span className="hint">Próximas 3 semanas</span>
                </div>
                {openShifts.map((s) => (
                  <div className="list-row" key={s.id}>
                    <span className="time-pill">{t5(s.start_time)}–{t5(s.end_time)}</span>
                    <div style={{ minWidth: 170 }}>
                      <b>{fmtDateLong(s.date)}</b>
                      <div className="muted" style={{ fontSize: 12.5 }}>{s.department_name || 'General'}</div>
                    </div>
                    <span className="badge badge-gray">{hoursLabel(durationMin(t5(s.start_time), t5(s.end_time), s.break_minutes))}</span>
                    <span className="spacer" />
                    <span className="hint">{DAY_NAMES[dow(s.date)]}</span>
                    <button className="btn btn-soft btn-sm" disabled={claiming === s.id} onClick={() => claim(s.id)}>
                      {claiming === s.id ? 'Enviando…' : 'Reclamar'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {mode === 'month' && (
              <div className="stat-grid mt-20">
                <div className="card stat-card"><span className="lbl">Turnos del mes</span><span className="val">{shifts.length}</span></div>
                <div className="card stat-card"><span className="lbl">Horas del mes</span><span className="val">{hoursLabel(shifts.reduce((a, s) => a + durationMin(t5(s.start_time), t5(s.end_time), s.break_minutes), 0))}</span></div>
                <div className="card stat-card"><span className="lbl">Media por semana</span><span className="val">{hoursLabel(Math.round(shifts.reduce((a, s) => a + durationMin(t5(s.start_time), t5(s.end_time), s.break_minutes), 0) / 4.3))}</span></div>
              </div>
            )}

            {mode === 'week' && (
              <div className="card card-pad mt-20">
                <h3 className="card-title mb-14">📋 Detalle de la semana</h3>
                {grouped.length === 0 && (
                  <div className="empty">
                    <div className="ico">🗓</div>
                    <b>Sin turnos esta semana</b>
                    Cuando se publique el horario de esta semana lo verás aquí.
                  </div>
                )}
                {grouped.map(([date, list]) => (
                  <div key={date} className="mb-14">
                    <p className="mb-8" style={{ fontWeight: 700, fontSize: 13.5 }}>{fmtDateLong(date)}</p>
                    {list.map((s) => (
                      <div className="list-row" key={s.id}>
                        <span className="time-pill">{t5(s.start_time)}–{t5(s.end_time)}</span>
                        {s.department_name && (
                          <span className="flex">
                            <Avatar name={s.department_name} color={s.department_color || '#94a3b8'} />
                            <span>{s.department_name}</span>
                          </span>
                        )}
                        <span className="spacer" />
                        {s.notes && <span className="hint">📝 {s.notes}</span>}
                        <span className="badge badge-green">{hoursLabel(durationMin(t5(s.start_time), t5(s.end_time), s.break_minutes))}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {swapModal && (
          <SwapModal
            shift={swapModal}
            staff={staff}
            onClose={() => setSwapModal(null)}
            onDone={() => { setSwapModal(null); load(); }}
          />
        )}
      </div>
    </>
  );
}
