import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { Avatar, ROLE_LABEL, Logo } from '../ui.jsx';
import { get, post } from '../api.js';

const MANAGER = ['owner', 'manager'];

const NOTIF_ICON = { claim: '🙋', leave: '🌴', swap: '🔁', schedule: '🗓' };

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

function NotificationBell() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const nav = useNavigate();

  const load = useCallback(() => {
    if (!user) return;
    get('/notifications').then((d) => { setItems(d.notifications); setUnread(d.unread); }).catch(() => {});
  }, [user]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const openItem = async (n) => {
    if (!n.read_at) post(`/notifications/${n.id}/read`).then(load).catch(() => {});
    setOpen(false);
    if (n.link) nav(n.link);
  };

  return (
    <div className="bell-wrap" ref={boxRef} style={{ position: 'relative' }}>
      <button className="btn btn-ghost btn-icon" aria-label="Notificaciones" onClick={() => setOpen((o) => !o)} style={{ position: 'relative' }}>
        🔔
        {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel card">
          <div className="notif-head">
            <b>Notificaciones</b>
            {unread > 0 && (
              <button className="btn btn-soft btn-sm" onClick={async () => { await post('/notifications/read-all'); load(); }}>
                Marcar todas
              </button>
            )}
          </div>
          <div className="notif-list">
            {items.length === 0 && <div className="empty" style={{ padding: '28px 16px' }}><div className="ico">🔕</div><b>Todo tranquilo</b>No hay novedades</div>}
            {items.map((n) => (
              <button key={n.id} className={`notif-item ${n.read_at ? '' : 'unread'}`} onClick={() => openItem(n)}>
                <span className="ni-ico">{NOTIF_ICON[n.type] || '•'}</span>
                <span className="ni-body">
                  <b>{n.title}</b>
                  {n.body && <span className="ni-sub">{n.body}</span>}
                </span>
                <span className="ni-time">{timeAgo(n.created_at)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, org, logout } = useAuth();
  const nav = useNavigate();
  const isManager = MANAGER.includes(user.role);

  const items = [
    { to: '/app', icon: '▦', label: 'Panel', end: true },
    ...(isManager ? [{ to: '/app/horario', icon: '🗓', label: 'Planificar' }] : []),
    { to: '/app/mis-turnos', icon: '⏱', label: 'Mis turnos' },
    { to: '/app/solicitudes', icon: '✉', label: 'Solicitudes' },
    ...(isManager ? [{ to: '/app/equipo', icon: '👥', label: 'Equipo' }] : []),
    { to: '/app/disponibilidad', icon: '☱', label: 'Disponibilidad' },
    { to: '/app/asistente', icon: '🤖', label: 'Asistente' },
    ...(isManager ? [{ to: '/app/marcaje', icon: '⏱', label: 'Marcaje' }] : []),
    ...(isManager ? [{ to: '/app/reportes', icon: '📊', label: 'Reportes' }] : []),
    ...(isManager ? [{ to: '/app/ajustes', icon: '⚙', label: 'Ajustes' }] : []),
    ...(isManager ? [{ to: '/app/auditoria', icon: '🛡', label: 'Auditoría' }] : []),
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/app" style={{ textDecoration: 'none' }}><Logo dark /></NavLink>
        <div className="sidebar-org">
          <b>{org?.name}</b>
          Planificación de turnos
        </div>
        <nav>
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <span className="ico">{it.icon}</span>
              <span className="lbl">{it.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <Avatar name={`${user.first_name} ${user.last_name}`} color={user.color} />
            <div>
              <div className="nm">{user.first_name} {user.last_name}</div>
              <div className="rl">{ROLE_LABEL[user.role]}</div>
            </div>
          </div>
          <button
            className="btn btn-ghost btn-sm mt-14"
            style={{ width: '100%', color: '#b9bcda', borderColor: 'rgba(255,255,255,.18)' }}
            onClick={async () => { await logout(); nav('/'); }}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>
      <div className="main">
        <Outlet />
      </div>
    </div>
  );
}

export function Topbar({ title, children }) {
  return (
    <header className="topbar">
      <h2>{title}</h2>
      <div className="actions">
        {children}
        <NotificationBell />
      </div>
    </header>
  );
}
