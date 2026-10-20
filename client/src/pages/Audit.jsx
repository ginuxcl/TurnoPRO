import { useEffect, useState } from 'react';
import { Topbar } from '../components/Layout.jsx';
import { get } from '../api.js';
import { Spinner, useToast } from '../ui.jsx';

const ICONS = {
  'auth.login': '🔓', 'auth.login_failed': '⚠️', 'auth.logout': '🔒', 'auth.register': '🏢',
  'auth.refresh_reuse_detected': '🚨', 'staff.created': '👤', 'staff.updated': '✏️', 'staff.deactivated': '🚪',
  'schedule.created': '🗓', 'schedule.published': '🚀', 'schedule.draft': '↩️', 'schedule.copied': '⧉',
  'shift.created': '➕', 'shift.updated': '✏️', 'shift.deleted': '🗑',
  'claim.created': '🙋', 'claim.approved': '✅', 'claim.rejected': '❌', 'claim.cancelled': '↩️',
  'leave.created': '🌴', 'leave.approved': '✅', 'leave.rejected': '❌', 'leave.cancelled': '↩️',
  'department.created': '📁', 'department.updated': '✏️', 'department.deleted': '🗑',
  'template.created': '🕘', 'template.updated': '✏️', 'template.deleted': '🗑',
  'availability.updated': '☱', 'me.profile_updated': '👤', 'me.password_changed': '🔑',
};

export default function Audit() {
  const toast = useToast();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get('/audit?limit=120')
      .then((d) => setLogs(d.logs))
      .catch((e) => toast(e.message, 'err'))
      .finally(() => setLoading(false));
  }, [toast]);

  const fmtTs = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + ' ' +
      d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  };

  const describe = (l) => {
    const map = {
      'auth.login': 'inició sesión',
      'auth.login_failed': 'falló un inicio de sesión',
      'auth.logout': 'cerró sesión',
      'auth.register': 'creó la organización',
      'auth.refresh_reuse_detected': 'posible robo de sesión detectado',
      'staff.created': 'añadió a una persona',
      'staff.updated': 'editó una ficha',
      'staff.deactivated': 'desactivó una cuenta',
      'schedule.created': 'creó un horario',
      'schedule.published': 'publicó el horario',
      'schedule.draft': 'devolvió el horario a borrador',
      'schedule.copied': 'copió la semana siguiente',
      'shift.created': 'creó un turno',
      'shift.updated': 'editó un turno',
      'shift.deleted': 'eliminó un turno',
      'claim.created': 'reclamó un turno abierto',
      'claim.approved': 'aprobó una reclamación',
      'claim.rejected': 'rechazó una reclamación',
      'claim.cancelled': 'retiró una reclamación',
      'leave.created': 'solicitó ausencia',
      'leave.approved': 'aprobó una ausencia',
      'leave.rejected': 'rechazó una ausencia',
      'leave.cancelled': 'canceló una ausencia',
      'department.created': 'creó un departamento',
      'department.updated': 'editó un departamento',
      'department.deleted': 'eliminó un departamento',
      'template.created': 'creó una plantilla',
      'template.updated': 'editó una plantilla',
      'template.deleted': 'eliminó una plantilla',
      'availability.updated': 'actualizó su disponibilidad',
      'me.profile_updated': 'actualizó su perfil',
      'me.password_changed': 'cambió su contraseña',
    };
    return map[l.action] || l.action;
  };

  return (
    <>
      <Topbar title="Auditoría">
        <span className="badge badge-green">🛡 Registro de seguridad</span>
      </Topbar>
      <div className="content" style={{ maxWidth: 900 }}>
        <p className="hint mb-14">Cada acción sensible queda registrada con actor, entidad, IP y fecha. Es tu tranquilidad operativa.</p>
        <div className="card">
          {loading ? <Spinner /> : (
            <table className="table">
              <thead><tr><th style={{ width: 150 }}>Fecha</th><th>Quién</th><th>Acción</th><th>Detalle</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="muted mono">{fmtTs(l.created_at)}</td>
                    <td><b>{l.actor_name || 'Sistema'}</b></td>
                    <td>
                      <span className="flex">
                        <span>{ICONS[l.action] || '•'}</span>
                        {describe(l)}
                      </span>
                    </td>
                    <td className="muted mono" style={{ fontSize: 12 }}>
                      {(() => {
                        try {
                          const d = typeof l.details === 'string' ? JSON.parse(l.details) : l.details;
                          return d && typeof d === 'object'
                            ? Object.entries(d).map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join(' · ')
                            : l.ip || '—';
                        } catch { return l.ip || '—'; }
                      })()}
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && <tr><td colSpan="4"><div className="empty"><div className="ico">🛡</div><b>Sin actividad aún</b></div></td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
