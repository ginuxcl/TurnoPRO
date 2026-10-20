import { useCallback, useEffect, useState } from 'react';
import { Topbar } from '../components/Layout.jsx';
import { Modal, Spinner, t5, todayStr, fmtDateLong, useToast, durationMin } from '../ui.jsx';
import { get, post, del } from '../api.js';

const minsH = (m) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—');

function ManualEntryModal({ date, staff, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ user_id: '', clock_in: '09:00', clock_out: '17:00', note: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!form.user_id) return toast('Elige una persona', 'error');
    setBusy(true);
    try {
      await post('/timeclock', { user_id: form.user_id, work_date: date, clock_in: form.clock_in, clock_out: form.clock_out, note: form.note || null });
      toast('Fichaje manual creado');
      onSaved();
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  };
  return (
    <Modal title="Añadir fichaje manual" onClose={onClose} footer={
      <>
        <button className="btn btn-soft" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Guardar'}</button>
      </>
    }>
      <div className="form-grid">
        <label>Persona
          <select className="input" value={form.user_id} onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))}>
            <option value="">— Elige —</option>
            {staff.map((p) => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
          </select>
        </label>
        <label>Fecha
          <input className="input" type="date" value={date} disabled />
        </label>
        <label>Entrada
          <input className="input" type="time" value={form.clock_in} onChange={(e) => setForm((f) => ({ ...f, clock_in: e.target.value }))} />
        </label>
        <label>Salida
          <input className="input" type="time" value={form.clock_out} onChange={(e) => setForm((f) => ({ ...f, clock_out: e.target.value }))} />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>Nota
          <input className="input" value={form.note} placeholder="Corrección, olvido de fichar…" onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} maxLength={200} />
        </label>
      </div>
    </Modal>
  );
}

export default function Timeclock() {
  const toast = useToast();
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState(null);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showManual, setShowManual] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [panel, st] = await Promise.all([get(`/timeclock/panel?date=${date}`), get('/staff')]);
      setData(panel);
      setStaff(st.staff.filter((p) => p.is_active));
    } catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const remove = async (id) => {
    try {
      await del(`/timeclock/${id}`);
      toast('Fichaje eliminado');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <Topbar title="Marcaje y control horario">
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 160 }} />
        <button className="btn btn-primary" onClick={() => setShowManual(true)}>+ Fichaje manual</button>
      </Topbar>
      <div className="page">
        <div className="card" style={{ padding: '14px 18px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>{fmtDateLong(date)}</b>
          <span className="muted" style={{ fontSize: 13 }}>
            Comparativa entre lo planificado y lo fichado realmente. Retrasos o salidas anticipadas de más de 5 min se marcan.
          </span>
        </div>

        {loading && <div className="card" style={{ display: 'grid', placeItems: 'center', padding: 40 }}><Spinner /></div>}

        {!loading && data && (
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Turno planificado</th>
                  <th>Entrada real</th>
                  <th>Salida real</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="dot" style={{ background: r.color }} />
                        <b>{r.user_name}</b>
                        <span className="muted" style={{ fontSize: 12 }}>{r.department_name || ''}</span>
                      </div>
                    </td>
                    <td>
                      <span className="chip">{t5(r.start_time)}–{t5(r.end_time)}</span>
                      <span className="muted" style={{ fontSize: 12 }}> {r.notes || ''}</span>
                    </td>
                    <td>{r.entry ? clock(r.entry.clock_in) : '—'}</td>
                    <td>{r.entry ? (r.entry.clock_out ? clock(r.entry.clock_out) : <b style={{ color: '#16a34a' }}>en curso</b>) : '—'}</td>
                    <td>
                      {durationMin(t5(r.start_time), t5(r.end_time), 0) >= 360 && !r.break_minutes && <span className="badge badge-red" title="Turno de 6+ horas sin pausa programada">sin pausa</span>}
                      {r.late_minutes != null && <span className="badge badge-amber">⏱ {minsH(r.late_minutes)} tarde</span>}
                      {r.left_early_minutes != null && <span className="badge badge-amber">↩ {minsH(r.left_early_minutes)} antes</span>}
                      {r.extra_minutes != null && r.extra_minutes > 0 && <span className="badge badge-green">+{minsH(r.extra_minutes)} extra</span>}
                      {!r.entry && <span className="badge badge-gray">sin fichar</span>}
                      {r.entry && r.late_minutes == null && r.left_early_minutes == null && r.entry.clock_out && <span className="badge badge-green">✓ en hora</span>}
                    </td>
                    <td>
                      {r.entry && (
                        <button className="btn btn-ghost btn-sm" title="Eliminar fichaje" onClick={() => remove(r.entry.id)}>🗑</button>
                      )}
                    </td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr><td colSpan="6"><div className="empty"><div className="ico">⏱</div><b>Sin turnos planificados ese día</b>No hay nada que comparar</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {showManual && <ManualEntryModal date={date} staff={staff} onClose={() => setShowManual(false)} onSaved={() => { setShowManual(false); load(); }} />}
      </div>
    </>
  );
}
