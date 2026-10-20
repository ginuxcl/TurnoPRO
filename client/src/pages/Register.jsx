import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { Logo } from '../ui.jsx';

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ org_name: '', first_name: '', last_name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register(form);
      nav('/app');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="auth-panel-inner">
          <Link to="/"><Logo /></Link>
          <h1>Crea tu espacio de trabajo</h1>
          <p className="sub">Serás el propietario: podrás invitar a gestores y empleados.</p>
          {error && <div className="auth-error">{error}</div>}
          <form onSubmit={submit}>
            <div className="field">
              <label>Nombre de la empresa</label>
              <input className="input" required value={form.org_name} onChange={set('org_name')} placeholder="Ej. Cafetería Central" />
            </div>
            <div className="input-row">
              <div className="field">
                <label>Nombre</label>
                <input className="input" required value={form.first_name} onChange={set('first_name')} placeholder="María" />
              </div>
              <div className="field">
                <label>Apellidos</label>
                <input className="input" required value={form.last_name} onChange={set('last_name')} placeholder="García" />
              </div>
            </div>
            <div className="field">
              <label>Email</label>
              <input className="input" type="email" required value={form.email} onChange={set('email')} placeholder="maria@empresa.com" />
            </div>
            <div className="field">
              <label>Contraseña</label>
              <input className="input" type="password" required value={form.password} onChange={set('password')} placeholder="Mín. 10 caracteres" />
              <span className="hint">Mínimo 10 caracteres, con mayúscula, minúscula y número.</span>
            </div>
            <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Creando…' : 'Crear cuenta'}
            </button>
          </form>
          <p className="mt-14 muted" style={{ textAlign: 'center' }}>
            ¿Ya tienes cuenta? <Link to="/login"><b>Inicia sesión</b></Link>
          </p>
        </div>
      </div>
      <div className="auth-side">
        <Logo dark />
        <blockquote className="mt-20">Todo lo que necesitas para cuadrar turnos sin dolores de cabeza, desde el primer día.</blockquote>
        <div className="stat-row">
          <div className="stat"><b>Gratis</b><span>para empezar</span></div>
          <div className="stat"><b>Sin CSVs</b><span>todo en la nube</span></div>
          <div className="stat"><b>ES / ISO</b><span>semanas de lunes a domingo</span></div>
        </div>
      </div>
    </div>
  );
}
