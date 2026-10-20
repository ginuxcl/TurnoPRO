import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { Logo } from '../ui.jsx';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
      nav('/app');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const demo = async () => {
    setBusy(true);
    setError('');
    try {
      await login('demo@turnos.app', 'Demo12345!');
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
          <h1>Bienvenido de nuevo</h1>
          <p className="sub">Accede para gestionar los turnos de tu equipo.</p>
          {error && <div className="auth-error">{error}</div>}
          <form onSubmit={submit}>
            <div className="field">
              <label>Email de trabajo</label>
              <input className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@empresa.com" />
            </div>
            <div className="field">
              <label>Contraseña</label>
              <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" />
            </div>
            <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Comprobando…' : 'Iniciar sesión'}
            </button>
          </form>
          <p className="mt-14 muted" style={{ textAlign: 'center' }}>
            ¿No tienes cuenta? <Link to="/register"><b>Crea una gratis</b></Link>
          </p>
          <div className="demo-box">
            <b>👥 Cuenta demo</b> — explora con datos reales de un gastrobar:
            <div className="mono">demo@turnos.app · Demo12345!</div>
            <button className="btn btn-soft btn-sm" onClick={demo} disabled={busy}>Entrar a la demo</button>
          </div>
        </div>
      </div>
      <div className="auth-side">
        <Logo dark />
        <blockquote className="mt-20">
          “Pasábamos tardes en Excel cuadrando turnos. Ahora publicamos la semana en 10 minutos
          y el equipo lo tiene todo en el móvil.”
        </blockquote>
        <div className="who">
          <span className="avatar" style={{ background: '#8b5cf6' }}>MR</span>
          <span><b>Marta R.</b> — Gerente de restauración</span>
        </div>
        <div className="stat-row">
          <div className="stat"><b>10 min</b><span>para planificar una semana</span></div>
          <div className="stat"><b>-70%</b><span>de ausencias sin cubrir</span></div>
          <div className="stat"><b>100%</b><span>del equipo informado</span></div>
        </div>
      </div>
    </div>
  );
}
