import { useEffect, useState } from 'react';
import { Topbar } from '../components/Layout.jsx';
import { get, put } from '../api.js';
import { DAY_SHORT, Spinner, useToast } from '../ui.jsx';

export default function Availability() {
  const toast = useToast();
  const [weekdays, setWeekdays] = useState([true, true, true, true, true, false, false]);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [notes, setNotes] = useState('');
  const [blocked, setBlocked] = useState([]);
  const [newBlocked, setNewBlocked] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      get('/availability/me').catch(() => ({ availability: null })),
      get('/preferences/me').catch(() => ({ blocked_dates: [] })),
    ]).then(([a, p]) => {
      if (a.availability) {
        setWeekdays(a.availability.weekdays.map(Boolean));
        setStart(a.availability.start_time);
        setEnd(a.availability.end_time);
        setNotes(a.availability.notes || '');
      }
      setBlocked(p.blocked_dates || []);
      setLoading(false);
    });
  }, []);

  const toggle = (i) => setWeekdays((wd) => wd.map((v, j) => (j === i ? !v : v)));

  const addBlocked = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newBlocked)) return toast('Elige una fecha válida', 'err');
    if (blocked.includes(newBlocked)) return;
    setBlocked((b) => [...b, newBlocked].sort());
    setNewBlocked('');
  };

  const save = async () => {
    setBusy(true);
    try {
      await put('/availability', { weekdays, start_time: start, end_time: end, notes: notes || null });
      await put('/preferences/me', { blocked_dates: blocked });
      toast('Disponibilidad guardada');
    } catch (e) {
      toast(e.message, 'err');
    }
    setBusy(false);
  };

  const daysOn = weekdays.filter(Boolean).length;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Topbar title="Mi disponibilidad" />
      <div className="content" style={{ maxWidth: 760 }}>
        <div className="card card-pad">
          {loading ? <Spinner /> : (
            <>
              <p className="muted mb-20" style={{ fontSize: 14 }}>
                Indica cuándo puedes trabajar. Tu gestor verá esta información al planificar turnos.
              </p>
              <div className="field">
                <label>Días disponibles ({daysOn}/7)</label>
                <div className="avail-grid">
                  {DAY_SHORT.map((d, i) => (
                    <div key={i} className={`avail-day ${weekdays[i] ? 'on' : ''}`} onClick={() => toggle(i)}>
                      <div className="nd">{d}</div>
                      <div className="hint">{weekdays[i] ? '✓' : '—'}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="input-row" style={{ maxWidth: 380 }}>
                <div className="field">
                  <label>Desde</label>
                  <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
                </div>
                <div className="field">
                  <label>Hasta</label>
                  <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label>Comentarios para tu gestor</label>
                <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. Las mañanas de los martes estudio hasta las 11:00" />
              </div>
              <div className="field">
                <label>Días que necesitas libres (médico, estudios, familia…)</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className="input" type="date" min={today} value={newBlocked} onChange={(e) => setNewBlocked(e.target.value)} style={{ maxWidth: 180 }} />
                  <button className="btn btn-soft" type="button" onClick={addBlocked}>+ Añadir</button>
                </div>
                {blocked.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                    {blocked.map((d) => (
                      <span key={d} className="blocked-chip" title="Clic para quitar" onClick={() => setBlocked((b) => b.filter((x) => x !== d))}>
                        {d.slice(8)}/{d.slice(5, 7)} ✕
                      </span>
                    ))}
                  </div>
                )}
                <p className="hint mt-8">El autocompletado nunca te asignará turnos estos días.</p>
              </div>
              <button className="btn btn-primary" onClick={save} disabled={busy || daysOn === 0}>
                {busy ? 'Guardando…' : 'Guardar disponibilidad'}
              </button>
              {daysOn === 0 && <p className="hint mt-14">Marca al menos un día.</p>}
            </>
          )}
        </div>
      </div>
    </>
  );
}
