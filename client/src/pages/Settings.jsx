import { useCallback, useEffect, useState } from 'react';
import { Topbar } from '../components/Layout.jsx';
import { get, post, patch, del } from '../api.js';
import { Modal, Spinner, t5, useToast } from '../ui.jsx';

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function DepModal({ dep, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState(dep?.name || '');
  const [color, setColor] = useState(dep?.color || '#0ea5e9');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (dep) { await patch(`/departments/${dep.id}`, { name, color }); toast('Departamento actualizado'); }
      else { await post('/departments', { name, color }); toast('Departamento creado'); }
      onSaved();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal title={dep ? 'Editar departamento' : 'Nuevo departamento'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy || !name}>Guardar</button>
      </>}>
      {error && <div className="inline-note err">{error}</div>}
      <div className="input-row">
        <div className="field"><label>Nombre</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Cocina" autoFocus /></div>
        <div className="field" style={{ maxWidth: 90 }}><label>Color</label>
          <input className="input" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 40, padding: 4 }} /></div>
      </div>
    </Modal>
  );
}

function TemplateModal({ tpl, departments, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: tpl?.name || '', start_time: t5(tpl?.start_time || '09:00'),
    end_time: t5(tpl?.end_time || '17:00'), break_minutes: tpl?.break_minutes ?? 0,
    color: tpl?.color || '#6366f1', department_id: tpl?.department_id || '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError('');
    const payload = { ...form, break_minutes: Number(form.break_minutes) || 0, department_id: form.department_id || null };
    try {
      if (tpl) { await patch(`/templates/${tpl.id}`, payload); toast('Plantilla actualizada'); }
      else { await post('/templates', payload); toast('Plantilla creada'); }
      onSaved();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal title={tpl ? 'Editar plantilla' : 'Nueva plantilla de turno'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy || !form.name}>Guardar</button>
      </>}>
      {error && <div className="inline-note err">{error}</div>}
      <div className="field"><label>Nombre</label>
        <input className="input" value={form.name} onChange={set('name')} placeholder="Ej. Mañana" autoFocus /></div>
      <div className="input-row">
        <div className="field"><label>Inicio</label><input className="input" type="time" value={form.start_time} onChange={set('start_time')} /></div>
        <div className="field"><label>Fin</label><input className="input" type="time" value={form.end_time} onChange={set('end_time')} /></div>
        <div className="field" style={{ maxWidth: 90 }}><label>Pausa (m)</label><input className="input" type="number" min="0" value={form.break_minutes} onChange={set('break_minutes')} /></div>
      </div>
      <div className="input-row">
        <div className="field"><label>Departamento</label>
          <select className="input" value={form.department_id} onChange={set('department_id')}>
            <option value="">— Ninguno —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></div>
        <div className="field" style={{ maxWidth: 90 }}><label>Color</label>
          <input className="input" type="color" value={form.color} onChange={set('color')} style={{ height: 40, padding: 4 }} /></div>
      </div>
    </Modal>
  );
}

function PatternModal({ pattern, onClose, onSaved }) {
  const toast = useToast();
  const empty = [[], [], [], [], [], [], []];
  const [name, setName] = useState(pattern?.name || '');
  const [days, setDays] = useState(pattern?.days?.map((d) => d.map((s) => ({ ...s }))) || empty);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const setSlot = (di, si, k, v) => setDays((ds) => ds.map((d, i) => (i === di ? d.map((s, j) => (j === si ? { ...s, [k]: v } : s)) : d)));
  const addSlot = (di) => setDays((ds) => ds.map((d, i) => (i === di ? [...d, { name: '', start_time: '09:00', end_time: '17:00', break_minutes: 0 }] : d)));
  const delSlot = (di, si) => setDays((ds) => ds.map((d, i) => (i === di ? d.filter((_, j) => j !== si) : d)));

  const submit = async () => {
    setBusy(true);
    setError('');
    const clean = days.map((d) => d.map((s) => ({ name: s.name || null, start_time: s.start_time, end_time: s.end_time, break_minutes: Number(s.break_minutes) || 0 })));
    try {
      if (pattern) { await patch(`/patterns/${pattern.id}`, { name, days: clean }); toast('Patrón actualizado'); }
      else { await post('/patterns', { name, days: clean }); toast('Patrón creado'); }
      onSaved();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal title={pattern ? 'Editar patrón semanal' : 'Nuevo patrón semanal'} onClose={onClose} width={720}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy || !name}>{busy ? <Spinner /> : 'Guardar patrón'}</button>
      </>}>
      {error && <div className="inline-note err">{error}</div>}
      <div className="field"><label>Nombre</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Semana cocina 5x2" autoFocus /></div>
      <p className="hint mb-8">Añade los turnos de cada día. Déjalo vacío para los días libres. Aplica el patrón desde Planificar → «Aplicar patrón».</p>
      <div className="pattern-grid">
        {DAYS.map((dn, di) => (
          <div key={di} className="pattern-day">
            <div className="pd-head">{dn} <button className="btn btn-ghost btn-sm" onClick={() => addSlot(di)} title="Añadir turno">+</button></div>
            {days[di].length === 0 && <div className="pd-free">Libre</div>}
            {days[di].map((s, si) => (
              <div key={si} className="pd-slot">
                <input className="input" type="time" value={s.start_time} onChange={(e) => setSlot(di, si, 'start_time', e.target.value)} />
                <input className="input" type="time" value={s.end_time} onChange={(e) => setSlot(di, si, 'end_time', e.target.value)} />
                <input className="input" type="number" min="0" title="Pausa (min)" value={s.break_minutes} onChange={(e) => setSlot(di, si, 'break_minutes', e.target.value)} style={{ maxWidth: 58 }} />
                <button className="modal-close" onClick={() => delSlot(di, si)} title="Quitar">✕</button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ApiKeysCard({ keys, reload }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const r = await post('/apikeys', { name });
      setCreated(r);
      setName('');
      reload();
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  const revoke = async (k) => {
    if (!confirm(`¿Revocar la clave "${k.name}"? Las integraciones que la usen dejarán de funcionar.`)) return;
    try { await del(`/apikeys/${k.id}`); toast('Clave revocada'); reload(); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="card card-pad mb-20">
      <h3 className="card-title mb-14">🔌 API para integraciones</h3>
      <p className="hint mb-14">
        Consulta los turnos publicados desde otros sistemas (nómina, BI, web…). Autenticación por cabecera <code>X-API-Key</code>:
        endpoints <code>GET /api/v1/public/v1/shifts</code> y <code>GET /api/v1/public/v1/employees</code> (solo lectura).
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la integración (ej. Nómina)" style={{ maxWidth: 260 }} />
        <button className="btn btn-soft" onClick={create} disabled={busy || !name}>+ Generar clave</button>
      </div>
      {created && (
        <div className="inline-note ok" style={{ marginBottom: 14 }}>
          <b>Copia la clave ahora — no se volverá a mostrar:</b>
          <code style={{ display: 'block', marginTop: 6, wordBreak: 'break-all', fontSize: 12.5 }}>{created.key}</code>
        </div>
      )}
      {keys.map((k) => (
        <div className="list-row" key={k.id}>
          <span className="dot" style={{ background: k.revoked_at ? '#cbd5e1' : '#16a34a' }} />
          <div>
            <b>{k.name}</b>
            <div className="muted" style={{ fontSize: 12 }}><code>{k.prefix}…</code> · creada {new Date(k.created_at).toLocaleDateString('es-ES')}{k.last_used_at ? ` · último uso ${new Date(k.last_used_at).toLocaleDateString('es-ES')}` : ''}</div>
          </div>
          <span className="spacer" />
          {k.revoked_at
            ? <span className="badge badge-gray">revocada</span>
            : <button className="btn btn-danger btn-sm" onClick={() => revoke(k)}>Revocar</button>}
        </div>
      ))}
      {keys.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Sin claves todavía.</p>}
    </div>
  );
}

export default function Settings() {
  const toast = useToast();
  const [org, setOrg] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [depModal, setDepModal] = useState(null);
  const [tplModal, setTplModal] = useState(null);
  const [patModal, setPatModal] = useState(null);
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '' });
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [rules, setRules] = useState(null);
  const [rulesBusy, setRulesBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [me, dp, tp, pt, hl, ak] = await Promise.all([
        get('/me'), get('/departments'), get('/templates'),
        get('/patterns'), get('/holidays'), get('/apikeys'),
      ]);
      setOrg(me.org);
      setRules(me.org.rules);
      setDepartments(dp.departments);
      setTemplates(tp.templates);
      setPatterns(pt.patterns);
      setHolidays(hl.holidays);
      setApiKeys(ak.keys);
    } catch (e) { toast(e.message, 'err'); }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const changePassword = async (e) => {
    e.preventDefault();
    setPwBusy(true);
    try {
      await post('/me/password', pw);
      toast('Contraseña cambiada. Vuelve a iniciar sesión.');
      setTimeout(() => window.location.assign('/login'), 900);
    } catch (e2) {
      toast(e2.message, 'err');
      setPwBusy(false);
    }
  };

  const removeDep = async (d) => {
    if (!confirm(`¿Eliminar el departamento "${d.name}"? Los turnos asociados quedarán sin departamento.`)) return;
    try { await del(`/departments/${d.id}`); toast('Eliminado'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const removeTpl = async (t) => {
    if (!confirm(`¿Eliminar la plantilla "${t.name}"?`)) return;
    try { await del(`/templates/${t.id}`); toast('Eliminada'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const removePattern = async (p) => {
    if (!confirm(`¿Eliminar el patrón "${p.name}"? Los turnos ya creados con él no se tocan.`)) return;
    try { await del(`/patterns/${p.id}`); toast('Patrón eliminado'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const addHoliday = async () => {
    if (!newHoliday.date || !newHoliday.name.trim()) return toast('Indica fecha y nombre del festivo', 'err');
    try {
      await post('/holidays', { date: newHoliday.date, name: newHoliday.name.trim() });
      setNewHoliday({ date: '', name: '' });
      load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const removeHoliday = async (h) => {
    try { await del(`/holidays/${h.id}`); toast('Festivo eliminado'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const saveRules = async () => {
    setRulesBusy(true);
    try {
      await patch('/me/org/rules', rules);
      toast('Reglas guardadas — se aplicarán al planificar y al aprobar cambios');
    } catch (e) { toast(e.message, 'err'); }
    setRulesBusy(false);
  };

  const setRule = (k, v) => setRules((r) => ({ ...r, [k]: v === '' ? null : Number(v) }));

  if (loading) return <><Topbar title="Ajustes" /><div className="content"><Spinner /></div></>;

  return (
    <>
      <Topbar title="Ajustes" />
      <div className="content" style={{ maxWidth: 900 }}>
        <div className="card card-pad mb-20">
          <h3 className="card-title mb-14">🏢 Organización</h3>
          <div className="input-row" style={{ maxWidth: 420 }}>
            <div className="field"><label>Nombre</label>
              <input className="input" value={org?.name || ''} disabled />
            </div>
          </div>
          <p className="hint">El nombre de la organización se muestra en la barra lateral y en las vistas del equipo.</p>
        </div>

        <div className="card card-pad mb-20">
          <div className="section-head">
            <h3 className="card-title">📁 Departamentos</h3>
            <button className="btn btn-soft btn-sm" onClick={() => setDepModal({})}>+ Nuevo</button>
          </div>
          <div className="flex" style={{ flexWrap: 'wrap', gap: 8 }}>
            {departments.length === 0 && <p className="muted">Sin departamentos todavía.</p>}
            {departments.map((d) => (
              <span key={d.id} className="badge badge-gray" style={{ fontSize: 13, padding: '7px 12px' }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, display: 'inline-block' }} />
                {d.name} · {d.members} pers.
                <button className="modal-close" style={{ width: 20, height: 20, fontSize: 11, marginLeft: 4, border: 'none', background: 'transparent', cursor: 'pointer' }} onClick={() => removeDep(d)}>✕</button>
              </span>
            ))}
          </div>
        </div>

        <div className="card mb-20">
          <div className="card-pad" style={{ paddingBottom: 10 }}>
            <div className="section-head">
              <h3 className="card-title">🕘 Plantillas de turno</h3>
              <button className="btn btn-soft btn-sm" onClick={() => setTplModal({})}>+ Nueva plantilla</button>
            </div>
            <p className="hint mb-14">Atajos para crear turnos habituales con un clic desde el calendario.</p>
          </div>
          <table className="table">
            <thead><tr><th>Nombre</th><th>Horario</th><th>Pausa</th><th>Depto.</th><th /></tr></thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td><span className="flex"><span style={{ width: 12, height: 12, borderRadius: 4, background: t.color }} /><b>{t.name}</b></span></td>
                  <td><span className="time-pill">{t5(t.start_time)}–{t5(t.end_time)}</span></td>
                  <td>{t.break_minutes} m</td>
                  <td className="muted">{departments.find((d) => d.id === t.department_id)?.name || '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setTplModal({ tpl: t })}>Editar</button>
                      <button className="btn btn-danger btn-sm" onClick={() => removeTpl(t)}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
              {templates.length === 0 && <tr><td colSpan="5"><div className="empty"><div className="ico">🕘</div><b>Sin plantillas</b>Crea turnos reutilizables para planificar más rápido</div></td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card mb-20">
          <div className="card-pad" style={{ paddingBottom: 10 }}>
            <div className="section-head">
              <h3 className="card-title">🔁 Patrones de semana (rotaciones)</h3>
              <button className="btn btn-soft btn-sm" onClick={() => setPatModal({})}>+ Nuevo patrón</button>
            </div>
            <p className="hint mb-14">
              Plantillas de semana completa (5x2, 7x7, 2x2…). Aplícalas en un clic desde Planificar → «Aplicar patrón».
            </p>
          </div>
          <table className="table">
            <thead><tr><th>Nombre</th><th>Turnos/semana</th><th>Detalle</th><th /></tr></thead>
            <tbody>
              {patterns.map((p) => {
                const total = p.days.reduce((a, d) => a + d.length, 0);
                const detail = p.days
                  .map((d, i) => d.map((s) => `${['L','M','X','J','V','S','D'][i]} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`).join(' · '))
                  .filter(Boolean).join('  |  ');
                return (
                  <tr key={p.id}>
                    <td><b>{p.name}</b></td>
                    <td><span className="badge badge-sky">{total}</span></td>
                    <td className="muted" style={{ fontSize: 12, maxWidth: 320 }}>{detail || 'Semana vacía'}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => setPatModal({ pattern: p })}>Editar</button>
                        <button className="btn btn-danger btn-sm" onClick={() => removePattern(p)}>Eliminar</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {patterns.length === 0 && <tr><td colSpan="4"><div className="empty"><div className="ico">🔁</div><b>Sin patrones</b>Crea rotaciones semanales reutilizables como 5x2 o 7x7</div></td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card card-pad mb-20">
          <div className="section-head">
            <h3 className="card-title">🎉 Festivos</h3>
          </div>
          <p className="hint mb-14">Se muestran en el calendario para todo el equipo.</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <input className="input" type="date" value={newHoliday.date} onChange={(e) => setNewHoliday((h) => ({ ...h, date: e.target.value }))} style={{ maxWidth: 170 }} />
            <input className="input" value={newHoliday.name} onChange={(e) => setNewHoliday((h) => ({ ...h, name: e.target.value }))} placeholder="Ej. Navidad" style={{ maxWidth: 200 }} />
            <button className="btn btn-soft" onClick={addHoliday}>+ Añadir festivo</button>
          </div>
          <div className="flex" style={{ flexWrap: 'wrap', gap: 8 }}>
            {holidays.map((h) => (
              <span key={h.id} className="badge badge-violet" style={{ fontSize: 13, padding: '7px 12px' }}>
                {h.date.slice(8)}/{h.date.slice(5, 7)} · {h.name}
                <button className="modal-close" style={{ width: 20, height: 20, fontSize: 11, marginLeft: 4, border: 'none', background: 'transparent', cursor: 'pointer' }} onClick={() => removeHoliday(h)}>✕</button>
              </span>
            ))}
            {holidays.length === 0 && <p className="muted">Sin festivos configurados.</p>}
          </div>
        </div>

        <ApiKeysCard keys={apiKeys} reload={load} />

        <div className="card card-pad mb-20">
          <h3 className="card-title mb-14">📐 Reglas de planificación</h3>
          <p className="hint mb-14">Se validan al asignar turnos, al aprobar cambios y al publicar. Un gestor puede forzar excepciones cuando algo sea imprescindible.</p>
          {rules && (
            <>
              <div className="input-row">
                <div className="field">
                  <label>Máx. turnos por día</label>
                  <input className="input" type="number" min="1" max="4" value={rules.max_shifts_per_day ?? ''} onChange={(e) => setRule('max_shifts_per_day', e.target.value)} />
                </div>
                <div className="field">
                  <label>Descanso mínimo entre turnos (h)</label>
                  <input className="input" type="number" min="0" max="16" value={rules.min_rest_hours ?? ''} onChange={(e) => setRule('min_rest_hours', e.target.value)} />
                </div>
              </div>
              <div className="input-row">
                <div className="field">
                  <label>Máx. días consecutivos</label>
                  <input className="input" type="number" min="1" max="14" value={rules.max_consecutive_days ?? ''} onChange={(e) => setRule('max_consecutive_days', e.target.value)} />
                </div>
                <div className="field">
                  <label>Tope semanal de horas (vacío = contrato de cada persona)</label>
                  <input className="input" type="number" min="1" max="80" value={rules.max_weekly_hours ?? ''} onChange={(e) => setRule('max_weekly_hours', e.target.value)} placeholder="p. ej. 40" />
                </div>
              </div>
              <button className="btn btn-primary" onClick={saveRules} disabled={rulesBusy}>{rulesBusy ? 'Guardando…' : 'Guardar reglas'}</button>
            </>
          )}
        </div>

        <div className="card card-pad mb-20">
          <h3 className="card-title mb-14">🔑 Cambiar mi contraseña</h3>
          <form onSubmit={changePassword} style={{ maxWidth: 380 }}>
            <div className="field"><label>Contraseña actual</label>
              <input className="input" type="password" required value={pw.current_password} onChange={(e) => setPw((p) => ({ ...p, current_password: e.target.value }))} /></div>
            <div className="field"><label>Nueva contraseña</label>
              <input className="input" type="password" required minLength={10} value={pw.new_password} onChange={(e) => setPw((p) => ({ ...p, new_password: e.target.value }))} />
              <span className="hint">Mín. 10 caracteres con mayúscula, minúscula y número. Se cerrarán todas tus sesiones.</span></div>
            <button className="btn btn-primary" disabled={pwBusy}>{pwBusy ? 'Cambiando…' : 'Cambiar contraseña'}</button>
          </form>
        </div>

        {depModal && <DepModal dep={depModal.dep} onClose={() => setDepModal(null)} onSaved={() => { setDepModal(null); load(); }} />}
        {tplModal && <TemplateModal tpl={tplModal.tpl} departments={departments} onClose={() => setTplModal(null)} onSaved={() => { setTplModal(null); load(); }} />}
        {patModal && <PatternModal pattern={patModal.pattern} onClose={() => setPatModal(null)} onSaved={() => { setPatModal(null); load(); }} />}
      </div>
    </>
  );
}
