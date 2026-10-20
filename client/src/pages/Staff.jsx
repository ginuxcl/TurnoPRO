import { useCallback, useEffect, useState } from 'react';
import { Topbar } from '../components/Layout.jsx';
import { get, post, patch, del } from '../api.js';
import { Avatar, Modal, ROLE_LABEL, Spinner, useToast } from '../ui.jsx';

function genPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  let out = '';
  for (let i = 0; i < 12; i++) out += all[Math.floor(Math.random() * all.length)];
  return out.slice(0, 4) + upper[Math.floor(Math.random() * upper.length)] + lower[3] + digits[Math.floor(Math.random() * 8)] + out.slice(6);
}

function StaffModal({ person, departments, onClose, onSaved }) {
  const toast = useToast();
  const editing = !!person;
  const [form, setForm] = useState({
    first_name: person?.first_name || '',
    last_name: person?.last_name || '',
    email: person?.email || '',
    role: person?.role === 'owner' ? 'employee' : person?.role || 'employee',
    position: person?.position || '',
    department_id: person?.department_id || '',
    phone: person?.phone || '',
    weekly_hours: person?.weekly_hours ?? 40,
    hourly_rate: person?.hourly_rate ?? '',
    color: person?.color || '#6366f1',
    password: editing ? '' : genPassword(),
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPass, setShowPass] = useState(!editing);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (editing) {
        const payload = {
          first_name: form.first_name, last_name: form.last_name,
          role: form.role, position: form.position || null,
          department_id: form.department_id || null, phone: form.phone || null,
          weekly_hours: Number(form.weekly_hours) || 0, color: form.color,
          hourly_rate: form.hourly_rate === '' ? null : Number(form.hourly_rate),
        };
        if (form.password) payload.new_password = form.password;
        await patch(`/staff/${person.id}`, payload);
        toast(form.password ? 'Cambios guardados · contraseña restablecida' : 'Cambios guardados');
      } else {
        await post('/staff', { ...form, weekly_hours: Number(form.weekly_hours) || 0, hourly_rate: form.hourly_rate === '' ? null : Number(form.hourly_rate), department_id: form.department_id || null, position: form.position || null, phone: form.phone || null });
        toast(`${form.first_name} se ha unido al equipo 🎉`);
      }
      onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? `Editar · ${person.first_name} ${person.last_name}` : 'Añadir persona'}
      onClose={onClose}
      width={560}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
      </>}
    >
      {error && <div className="inline-note err">{error}</div>}
      <div className="input-row">
        <div className="field">
          <label>Nombre</label>
          <input className="input" value={form.first_name} onChange={set('first_name')} />
        </div>
        <div className="field">
          <label>Apellidos</label>
          <input className="input" value={form.last_name} onChange={set('last_name')} />
        </div>
      </div>
      <div className="field">
        <label>Email</label>
        <input className="input" type="email" value={form.email} onChange={set('email')} disabled={editing} />
      </div>
      <div className="input-row">
        <div className="field">
          <label>Rol</label>
          <select className="input" value={form.role} onChange={set('role')} disabled={person?.role === 'owner'}>
            <option value="employee">Empleado</option>
            <option value="manager">Gestor</option>
          </select>
        </div>
        <div className="field">
          <label>Puesto</label>
          <input className="input" value={form.position} onChange={set('position')} placeholder="Ej. Camarero" />
        </div>
      </div>
      <div className="input-row">
        <div className="field">
          <label>Departamento</label>
          <select className="input" value={form.department_id} onChange={set('department_id')}>
            <option value="">— Ninguno —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Horas/semana</label>
          <input className="input" type="number" min="0" max="80" value={form.weekly_hours} onChange={set('weekly_hours')} />
        </div>
      </div>
      <div className="input-row">
        <div className="field">
          <label>Teléfono</label>
          <input className="input" value={form.phone} onChange={set('phone')} placeholder="Opcional" />
        </div>
        <div className="field">
          <label>Valor hora (€) · opcional</label>
          <input className="input" type="number" min="0" max="999" step="0.01" value={form.hourly_rate} onChange={set('hourly_rate')} placeholder="Para costes en reportes" />
        </div>
        <div className="field">
          <label>Color</label>
          <input className="input" type="color" value={form.color} onChange={set('color')} style={{ height: 40, padding: 4 }} />
        </div>
      </div>
      <div className="field">
        <label>{editing ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'}</label>
        <div className="flex">
          <input className="input mono" value={form.password} onChange={set('password')} placeholder="Mín. 10 caracteres" />
          <button className="btn btn-ghost btn-sm" onClick={() => setShowPass(true)}>👁</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setForm((f) => ({ ...f, password: genPassword() }))}>🎲</button>
        </div>
        <span className="hint">{editing ? 'Déjalo vacío para mantener la actual. Se compartirla de forma segura con la persona.' : 'Compártela con la persona de forma segura; podrá cambiarla en Ajustes.'}</span>
      </div>
      {showPass && !form.password && <div className="inline-note err">Introduce una contraseña válida</div>}
    </Modal>
  );
}

export default function Staff() {
  const toast = useToast();
  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [st, dp] = await Promise.all([get('/staff'), get('/departments')]);
      setStaff(st.staff);
      setDepartments(dp.departments);
    } catch (e) {
      toast(e.message, 'err');
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async (p) => {
    if (!confirm(p.is_active ? `¿Desactivar a ${p.first_name}? Perderá el acceso, pero se conserva su historial.` : `¿Reactivar a ${p.first_name}?`)) return;
    try {
      if (p.is_active) await del(`/staff/${p.id}`);
      else await patch(`/staff/${p.id}`, { is_active: true });
      toast(p.is_active ? 'Persona desactivada' : 'Persona reactivada');
      load();
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const active = staff.filter((p) => p.is_active);
  const totalHours = active.reduce((a, p) => a + p.weekly_hours, 0);

  return (
    <>
      <Topbar title="Equipo">
        <span className="muted">{active.length} activos · {totalHours} h/semana</span>
        <button className="btn btn-primary btn-sm" onClick={() => setModal({})}>+ Añadir persona</button>
      </Topbar>
      <div className="content">
        <div className="card">
          {loading ? <Spinner /> : (
            <table className="table">
              <thead>
                <tr><th>Persona</th><th>Rol</th><th>Puesto</th><th>Departamento</th><th>Horas/sem</th><th>Email</th><th /></tr>
              </thead>
              <tbody>
                {staff.map((p) => (
                  <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.5 }}>
                    <td>
                      <span className="flex">
                        <Avatar name={`${p.first_name} ${p.last_name}`} color={p.color} size="avatar-lg" />
                        <div>
                          <b>{p.first_name} {p.last_name}</b>
                          {!p.is_active && <div><span className="badge badge-gray">Desactivado</span></div>}
                        </div>
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${p.role === 'employee' ? 'badge-gray' : p.role === 'manager' ? 'badge-sky' : 'badge-violet'}`}>
                        {ROLE_LABEL[p.role]}
                      </span>
                    </td>
                    <td>{p.position || <span className="muted">—</span>}</td>
                    <td>{p.department_name ? <span className="badge badge-gray">{p.department_name}</span> : <span className="muted">—</span>}</td>
                    <td><b>{p.weekly_hours} h</b></td>
                    <td className="muted">{p.email}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => setModal({ person: p })}>Editar</button>
                        {p.role !== 'owner' && (
                          <button className={`btn btn-sm ${p.is_active ? 'btn-danger' : 'btn-success'}`} onClick={() => toggleActive(p)}>
                            {p.is_active ? 'Desactivar' : 'Reactivar'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="hint mt-14">🔒 Desactivar nunca borra el historial: los turnos pasados quedan intactos para auditoría.</p>
        {modal && <StaffModal person={modal.person} departments={departments} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
      </div>
    </>
  );
}
