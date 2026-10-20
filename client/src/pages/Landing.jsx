import { useNavigate } from 'react-router-dom';
import { Logo } from '../ui.jsx';
import { useAuth } from '../AuthContext.jsx';
import { useState } from 'react';

const DEMO = { email: 'demo@turnos.app', password: 'Demo12345!' };

export default function Landing() {
  const nav = useNavigate();
  const { login } = useAuth();
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [err, setErr] = useState('');

  const tryDemo = async () => {
    setLoadingDemo(true);
    setErr('');
    try {
      await login(DEMO.email, DEMO.password);
      nav('/app');
    } catch (e) {
      setErr(e.message);
      setLoadingDemo(false);
    }
  };

  return (
    <div className="landing">
      <nav className="landing-nav">
        <Logo dark />
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-hero-outline" style={{ padding: '10px 20px', fontSize: 14 }} onClick={() => nav('/login')}>
            Iniciar sesión
          </button>
          <button className="btn btn-hero" style={{ padding: '10px 20px', fontSize: 14 }} onClick={() => nav('/register')}>
            Crear cuenta gratis
          </button>
        </div>
      </nav>

      <header className="landing-hero">
        <span className="landing-badge">⚡ Planificación de turnos con inteligencia</span>
        <h1>
          Las tiendas que cierran mal<br />el horario, <span className="grad">pierden al equipo</span>
        </h1>
        <p className="landing-sub">
          TurnoPro crea, publica y gestiona los turnos de tu equipo en minutos, no en horas.
          Cobertura perfecta, cambios justos y todo el personal conectado desde el móvil.
        </p>
        <div className="landing-cta">
          <button className="btn-hero" onClick={tryDemo} disabled={loadingDemo}>
            {loadingDemo ? 'Entrando…' : '▶ Explorar la demo en vivo'}
          </button>
          <button className="btn-hero-outline" onClick={() => nav('/register')}>Empezar gratis</button>
        </div>
        {err && <p style={{ marginTop: 14, color: '#fca5a5', fontWeight: 600 }}>{err}</p>}

        <div className="landing-mock" aria-hidden="true">
          <div className="mock-bar">
            <i style={{ background: '#ff5f57' }} /><i style={{ background: '#febc2e' }} /><i style={{ background: '#28c840' }} />
          </div>
          <div className="mock-body">
            <div className="mock-side">
              <i className="on" /><i /><i /><i /><i />
            </div>
            <div className="mock-main">
              <div className="mock-grid">
                {[['LUN', [['#6d6df0', 'Ana · Cocina', '10:00–17:00'], ['#0ea5e9', 'Carlos · Sala', '17:00–00:00']]],
                  [['MAR'], [['#f97316', 'Pablo · Cocina', '10:00–17:00'], ['#0ea5e9', 'Carlos · Sala', '17:00–00:00']]],
                  [['MIÉ'], [['#f97316', 'Ana · Cocina', '10:00–17:00'], ['#8b5cf6', 'Lucía · Barra', '17:00–00:30']]],
                  [['JUE'], [['#f97316', 'Ana · Cocina', '10:00–17:00'], ['#ec4899', 'Elena · Sala', '17:00–00:00']]],
                  [['VIE'], [['#14b8a6', 'Javier · Sala', '12:00–22:00'], ['#8b5cf6', 'Lucía · Barra', '18:00–01:00']]],
                ].map(([day, shifts], i) => (
                  <div className="mock-col" key={i}>
                    <b>{day}</b>
                    {shifts.map(([color, who, time], j) => (
                      <div className="mock-shift" key={j} style={{ background: `${color}33`, border: `1px solid ${color}66` }}>
                        <b>{who}</b><span>{time}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="landing-features">
        <div className="landing-feature">
          <div className="ico">🗓</div>
          <h3>Planifica en minutos</h3>
          <p>Vista semanal y mensual, arrastra turnos entre días, copia la semana anterior y publica. Los solapamientos se pintan lado a lado, sin caos.</p>
        </div>
        <div className="landing-feature">
          <div className="ico">⚡</div>
          <h3>Autocompletado inteligente</h3>
          <p>Los huecos se asignan solos respetando ausencias, disponibilidad, descansos y equidad de carga. Tú revisas y publicas.</p>
        </div>
        <div className="landing-feature">
          <div className="ico">🔁</div>
          <h3>Cambios y turnos abiertos</h3>
          <p>Publica huecos que el equipo puede reclamar y permite ceder turnos entre compañeros, con validación de reglas antes de aprobar.</p>
        </div>
        <div className="landing-feature">
          <div className="ico">🌴</div>
          <h3>Vacaciones y bajas bajo control</h3>
          <p>Solicitudes de ausencia con flujo de aprobación. Al aprobar, los turnos afectados se liberan automáticamente.</p>
        </div>
        <div className="landing-feature">
          <div className="ico">📐</div>
          <h3>Reglas de tu negocio</h3>
          <p>Descanso mínimo, días consecutivos, topes de horas: se validan al planificar y el gestor puede forzar excepciones justificadas.</p>
        </div>
        <div className="landing-feature">
          <div className="ico">⏱</div>
          <h3>Fichaje y control horario</h3>
          <p>Entrada y salida con un clic y panel para el gestor que compara lo planificado con lo realmente trabajado: retrasos, salidas anticipadas y horas extra.</p>
        </div>
        <div className="landing-feature">
          <div className="ico">📊</div>
          <h3>Reportes y costes en Excel</h3>
          <p>Horas por persona y departamento, desviaciones y coste estimado con el valor hora de cada empleado. Exportación Excel profesional con colores y totales.</p>
        </div>
        <div className="landing-feature">
          <div className="ico">🔁</div>
          <h3>Patrones y rotaciones</h3>
          <p>Guarda tus semanas tipo (5x2, 7x7, fines reforzados) y aplícalas a cualquier semana en un clic. Festivos de tu calendario visibles para todo el equipo.</p>
        </div>
        <div className="landing-feature">
          <div className="ico">🔌</div>
          <h3>Abierto a integraciones</h3>
          <p>API de solo lectura con claves para conectar nómina o BI, y preferencias del empleado: días bloqueados que el autocompletado respeta.</p>
        </div>
        <div className="landing-feature">
          <div className="ico">🛡</div>
          <h3>Seguridad de nivel bancario</h3>
          <p>Sesiones con tokens rotatorios, permisos por rol, aislamiento estricto por empresa y registro de auditoría completo.</p>
        </div>
      </section>

      <footer className="landing-footer">
        TurnoPro — gestión de turnos para hostelería, retail y salud. Hecho con ❤ y PostgreSQL.
      </footer>
    </div>
  );
}
