import { useEffect, useState } from 'react';
import { Modal, fmtDateLong, useToast, t5 } from '../ui.jsx';
import { get, post, patch, del } from '../api.js';

/**
 * Modal de creación/edición de turno (solo gestores).
 * shift=null → crear en (date, time); shift → editar.
 */
export default function ShiftModal({ shift, date, time, presetUser, staff, departments, templates, onClose, onSaved, onDeleted }) {
  const toast = useToast();
  const editing = !!shift;
  const [form, setForm] = useState({
    date: date || shift?.date || '',
    start_time: t5(time || shift?.start_time || '09:00'),
    end_time: t5(shift?.end_time || '15:00'),
    break_minutes: shift?.break_minutes ?? 0,
    department_id: shift?.department_id || '',
    user_id: presetUser || shift?.user_id || '',
    notes: shift?.notes || '',
  });
  const [error, setError] = useState('');
  const [violations, setViolations] = useState([]);
  const [busy, setBusy] = useState(false);
  const [frequent, setFrequent] = useState([]);
  const [blocked, setBlocked] = useState([]);

  useEffect(() => {
    get('/shifts/frequent').then((d) => setFrequent(d.frequent)).catch(() => {});
  }, []);

  // Aviso de días bloqueados de la persona asignada (preferencias del empleado)
  useEffect(() => {
    if (!form.user_id) { setBlocked([]); return; }
    get(`/preferences/of/${form.user_id}`).then((d) => setBlocked(d.blocked_dates)).catch(() => setBlocked([]));
  }, [form.user_id]);

  useEffect(() => {
    setError('');
    setViolations([]);
  }, [form]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const applyTemplate = (tplId) => {
    const tpl = templates.find((t) => t.id === tplId);
    if (!tpl) return;
    setForm((f) => ({
      ...f,
      start_time: t5(tpl.start_time), end_time: t5(tpl.end_time),
      break_minutes: tpl.break_minutes,
      department_id: tpl.department_id || f.department_id,
    }));
  };

  const save = async (force = false) => {
    setBusy(true);
    setError('');
    const payload = {
      date: form.date,
      start_time: form.start_time,
      end_time: form.end_time,
      break_minutes: Number(form.break_minutes) || 0,
      department_id: form.department_id || null,
      user_id: form.user_id || null,
      notes: form.notes || null,
      ...(force ? { force: true } : {}),
    };
    try {
      if (editing) {
        await patch(`/shifts/${shift.id}`, payload);
        toast('Turno actualizado');
      } else {
        await post('/shifts', payload);
        toast('Turno creado');
      }
      onSaved();
    } catch (e) {
      if (e.code === 'RULES' && e.violations?.length) {
        setViolations(e.violations);
      } else {
        setError(e.message);
      }
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('¿Eliminar este turno?')) return;
    setBusy(true);
    try {
      await del(`/shifts/${shift.id}`);
      toast('Turno eliminado');
      onDeleted?.();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const duration = (() => {
    const [sh, sm] = form.start_time.split(':').map(Number);
    const [eh, em] = form.end_time.split(':').map(Number);
    let d = eh * 60 + em - (sh * 60 + sm);
    if (d <= 0) d += 1440;
    return Math.max(0, d - (Number(form.break_minutes) || 0));
  })();

  return (
    <Modal
      title={editing ? 'Editar turno' : 'Nuevo turno'}
      onClose={onClose}
      footer={
        <>
          {editing && <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={remove} disabled={busy}>Eliminar</button>}
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          {violations.length > 0
            ? <button className="btn btn-danger" onClick={() => save(true)} disabled={busy}>Forzar igualmente</button>
            : <button className="btn btn-primary" onClick={() => save(false)} disabled={busy}>{busy ? 'Guardando…' : 'Guardar turno'}</button>}
        </>
      }
    >
      {error && <div className="inline-note err">{error}</div>}
      {violations.length > 0 && (
        <div className="inline-note err">
          <b>⚠️ Reglas de planificación incumplidas:</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {violations.map((v, i) => <li key={i}>{v}</li>)}
          </ul>
          <span style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
            Puedes guardar igualmente como gestor, o ajusta el turno.
          </span>
        </div>
      )}
      {!editing && templates.length > 0 && (
        <div className="field">
          <label>Aplicar plantilla</label>
          <select className="input" value="" onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">— Elegir plantilla —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} · {t5(t.start_time)}–{t5(t.end_time)}</option>
            ))}
          </select>
        </div>
      )}
      {!editing && frequent.length > 0 && (
        <div className="field">
          <label>Turnos frecuentes (últimas 4 semanas)</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {frequent.map((f, i) => (
              <button
                key={i}
                type="button"
                className={`btn btn-sm ${form.start_time === t5(f.start_time) && form.end_time === t5(f.end_time) ? 'btn-primary' : 'btn-soft'}`}
                onClick={() => setForm((fo) => ({ ...fo, start_time: t5(f.start_time), end_time: t5(f.end_time), break_minutes: f.break_minutes }))}
              >
                {t5(f.start_time)}–{t5(f.end_time)} <span style={{ opacity: 0.75 }}>· ×{f.uses}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <label>Día</label>
        <input className="input" type="date" value={form.date} onChange={set('date')} required />
      </div>
      <div className="input-row">
        <div className="field">
          <label>Inicio</label>
          <input className="input" type="time" value={form.start_time} onChange={set('start_time')} required />
        </div>
        <div className="field">
          <label>Fin</label>
          <input className="input" type="time" value={form.end_time} onChange={set('end_time')} required />
        </div>
        <div className="field" style={{ maxWidth: 90 }}>
          <label>Pausa (m)</label>
          <input className="input" type="number" min="0" max="720" value={form.break_minutes} onChange={set('break_minutes')} />
        </div>
      </div>
      <div className="field">
        <label>Asignar a</label>
        <select className="input" value={form.user_id} onChange={set('user_id')}>
          <option value="">🔓 Turno abierto (reclamable)</option>
          {staff.filter((p) => p.is_active).map((p) => (
            <option key={p.id} value={p.id}>{p.first_name} {p.last_name} · {p.position || 'Personal'}{blocked.includes(form.date) && form.user_id === p.id ? ' ⛔ día bloqueado' : ''}{p.role !== 'employee' ? ` (${p.role === 'owner' ? 'propietario' : 'gestor'})` : ''}</option>
          ))}
        </select>
        {form.user_id && blocked.includes(form.date) && (
          <div className="inline-note warn" style={{ marginTop: 6 }}>
            ⛔ Esta persona tiene el {fmtDateLong(form.date)} marcado como día bloqueado en sus preferencias. Se lo saltará el autocompletado; asigna con criterio.
          </div>
        )}
      </div>
      <div className="field">
        <label>Departamento</label>
        <select className="input" value={form.department_id} onChange={set('department_id')}>
          <option value="">— Sin departamento —</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Notas</label>
        <input className="input" value={form.notes} onChange={set('notes')} placeholder="Opcional: p. ej. servicio de evento" />
      </div>
      <p className="hint">Duración efectiva: <b>{Math.floor(duration / 60)} h {duration % 60 ? `${duration % 60} m` : ''}</b>{form.end_time <= form.start_time ? ' · turno de madrugada (cruza medianoche)' : ''}</p>
      <p className="hint" style={{ marginTop: 4 }}>{form.date ? fmtDateLong(form.date) : ''}</p>
    </Modal>
  );
}
