import { useCallback, useEffect, useState } from 'react';
import { Topbar } from '../components/Layout.jsx';
import { Link } from 'react-router-dom';
import { get, post } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { Avatar, Spinner, fmtDateLong, hoursLabel, t5, useToast, durationMin } from '../ui.jsx';

function StatCard({ label, value, note, icon }) {
  return (
    <div className="card stat-card">
      <span className="lbl">{label}</span>
      <span className="val">{value}</span>
      {note && <span className="note">{note}</span>}
      <span className="bg-ico">{icon}</span>
    </div>
  );
}

function PunchCard() {
  const toast = useToast();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => { get('/timeclock/status').then(setSt).catch(() => {}); }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(tick); };
  }, [load]);

  const punch = async () => {
    setBusy(true);
    try {
      const r = await post('/timeclock/clock');
      toast(r.action === 'in' ? '🟢 Entrada fichada' : '🔴 Salida fichada. ¡Buen trabajo!');
      load();
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };

  const elapsed = st?.active ? Math.max(0, Math.floor((now - new Date(st.active.clock_in).getTime()) / 1000)) : 0;
  const hh = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className={`punch-card card card-pad ${st?.active ? 'punching' : ''}`}>
      <div className="section-head">
        <h3 className="card-title">{st?.active ? '🟢 Fichaje en curso' : '⏱ Control horario'}</h3>
        {st?.active && <span className="badge badge-green">{hh}:{mm}:{ss}</span>}
      </div>
      {st?.today_shift && (
        <p className="muted mb-8" style={{ fontSize: 13 }}>
          Hoy tienes turno de <b>{t5(st.today_shift.start_time)} a {t5(st.today_shift.end_time)}</b>
        </p>
      )}
      {!st?.today_shift && st && (
        <p className="muted mb-8" style={{ fontSize: 13 }}>Hoy no tienes turno asignado</p>
      )}
      <button
        className={`btn ${st?.active ? 'btn-danger' : 'btn-primary'}`}
        style={{ width: '100%', height: 46, fontSize: 15 }}
        onClick={punch}
        disabled={busy || !st}
      >
        {busy ? <Spinner /> : st?.active ? '🔴 Fichar salida' : '🟢 Fichar entrada'}
      </button>
    </div>
  );
}

export default function Dashboard() {
  const { user, org } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);

  useEffect(() => {
    get('/dashboard').then(setData).catch((e) => toast(e.message, 'err'));
  }, [toast]);

  if (!data) return <><Topbar title={`Hola, ${user.first_name} 👋`} /><div className="content"><Spinner /></div></>;

  const isManager = user.role !== 'employee';
  const pct = Math.min(100, Math.round((data.my_minutes_this_week / 60 / (data.weekly_hours_target || 40)) * 100));
  const coverage = data.week_total_shifts ? Math.round((data.week_assigned_shifts / data.week_total_shifts) * 100) : 0;
  const firstName = (n) => (n || '').split(' ')[0];

  return (
    <>
      <Topbar title={`Hola, ${user.first_name} 👋`}>
        <span className="muted">{org?.name}</span>
      </Topbar>
      <div className="content">
        <div className="stat-grid">
          <StatCard label="Horas esta semana" value={hoursLabel(data.my_minutes_this_week)} note={`Objetivo: ${data.weekly_hours_target} h`} icon="⏱" />
          {isManager ? (
            <>
              <StatCard label="Turnos hoy" value={data.today_shifts.length} note={`${data.active_staff} personas en plantilla`} icon="🗓" />
              <StatCard label="Turnos abiertos" value={data.open_shifts} note="publicados sin asignar" icon="🔓" />
              <StatCard label="Pendientes" value={Number(data.pending.leave) + Number(data.pending.claims)} note={`${data.pending.leave} ausencias · ${data.pending.claims} reclamaciones`} icon="✉" />
            </>
          ) : (
            <>
              <StatCard label="Próximo turno" value={data.upcoming[0] ? t5(data.upcoming[0].start_time) : '—'} note={data.upcoming[0] ? fmtDateLong(data.upcoming[0].date) : 'nada planificado'} icon="⏰" />
              <StatCard label="Mis solicitudes" value={Number(data.my_pending.leave) + Number(data.my_pending.claims)} note="en curso" icon="✉" />
              <StatCard label="Turnos semana" value={data.my_shifts_this_week} note="asignados a ti" icon="🗓" />
            </>
          )}
        </div>

        <div className="grid-2">
          <div>
            {isManager && (
              <div className="card card-pad mb-20">
                <div className="section-head">
                  <h3 className="card-title">🕘 Hoy en {org?.name}</h3>
                  <Link to="/app/horario" className="btn btn-ghost btn-sm">Ver horario</Link>
                </div>
                {data.today_shifts.length === 0 && <div className="empty"><div className="ico">🌤</div><b>Nadie trabaja hoy</b>Disfruta del día tranquilo</div>}
                {data.today_shifts.map((s, i) => (
                  <div className="list-row" key={i}>
                    <span className="time-pill">{t5(s.start_time)}–{t5(s.end_time)}</span>
                    {s.first_name
                      ? <><Avatar name={`${s.first_name} ${s.last_name}`} color={s.color} /><b>{s.first_name} {s.last_name}</b></>
                      : <span className="badge badge-amber">🔓 Turno abierto</span>}
                    <span className="spacer" />
                    {s.department_name && <span className="badge badge-gray">{s.department_name}</span>}
                  </div>
                ))}
              </div>
            )}

            <div className="card card-pad">
              <div className="section-head">
                <h3 className="card-title">⏰ Mis próximos turnos</h3>
                <Link to="/app/mis-turnos" className="btn btn-ghost btn-sm">Ver todos</Link>
              </div>
              {data.upcoming.length === 0 && <div className="empty"><div className="ico">🏖</div><b>Sin turnos a la vista</b>Cuando se publique el horario aparecerán aquí</div>}
              {data.upcoming.map((s, i) => (
                <div className="list-row" key={i}>
                  <span className="time-pill">{t5(s.start_time)}–{t5(s.end_time)}</span>
                  <div>
                    <b>{fmtDateLong(s.date)}</b>
                    <div className="muted" style={{ fontSize: 12.5 }}>{s.department_name || '—'}</div>
                  </div>
                  <span className="spacer" />
                  <span className="badge badge-green">{hoursLabel(durationMin(t5(s.start_time), t5(s.end_time), s.break_minutes))}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-20"><PunchCard /></div>

            <div className="card card-pad mb-20">
              <h3 className="card-title mb-14">📊 Mi semana</h3>
              <p className="muted mb-8" style={{ fontSize: 13 }}>{hoursLabel(data.my_minutes_this_week)} de {data.weekly_hours_target} h</p>
              <div className="progress"><i className={pct > 100 ? 'warn' : pct > 75 ? '' : 'ok'} style={{ width: `${pct}%` }} /></div>
              <p className="hint mt-14">{data.my_shifts_this_week} turnos asignados esta semana ({data.week_start.slice(8)}/{data.week_start.slice(5, 7)})</p>
            </div>

            {isManager && (
              <div className="card card-pad mb-20">
                <h3 className="card-title mb-14">🧩 Cobertura semanal</h3>
                <p className="muted mb-8" style={{ fontSize: 13 }}>{data.week_assigned_shifts} de {data.week_total_shifts} turnos asignados</p>
                <div className="progress"><i className={coverage >= 90 ? 'ok' : coverage >= 60 ? '' : 'warn'} style={{ width: `${coverage}%` }} /></div>
                <p className="hint mt-14">{coverage}% cubierto · {data.week_total_shifts - data.week_assigned_shifts} abiertos</p>
                {data.next_week_open > 0 && (
                  <p className="hint" style={{ color: '#b45309' }}>👀 A una semana vista: <b>{data.next_week_open} turno(s) abiertos</b> en la semana que viene.</p>
                )}
                {data.next_week_overload?.length > 0 && (
                  <p className="hint" style={{ color: '#b91c1c' }}>
                    ⚠️ Sobrecarga próxima: {data.next_week_overload.map((o) => o.name).join(', ')} superan su jornada.
                  </p>
                )}
                <Link to="/app/horario" className="btn btn-primary btn-sm mt-14" style={{ width: '100%' }}>Planificar turnos</Link>
              </div>
            )}

            <div className="card card-pad">
              <h3 className="card-title mb-14">✉ Solicitudes</h3>
              <div className="list-row">
                <span className="badge badge-amber">Ausencias</span>
                <span className="spacer" />
                <b>{isManager ? data.pending.leave : data.my_pending.leave} pendientes</b>
              </div>
              <div className="list-row">
                <span className="badge badge-sky">Reclamaciones</span>
                <span className="spacer" />
                <b>{isManager ? data.pending.claims : data.my_pending.claims} pendientes</b>
              </div>
              <Link to="/app/solicitudes" className="btn btn-soft btn-sm mt-14" style={{ width: '100%' }}>Gestionar solicitudes</Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
