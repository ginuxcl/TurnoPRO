import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Topbar } from '../components/Layout.jsx';
import { get, post } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { Avatar, LEAVE_BADGE, LEAVE_LABEL, Modal, STATUS_BADGE, Spinner, fmtDate, fmtDateLong, t5, useToast } from '../ui.jsx';

const SWAP_BADGE = {
  pending: ['Esperando respuesta', 'badge-amber'],
  accepted: ['Aceptado · por aprobar', 'badge-sky'],
  approved: ['Aprobado', 'badge-green'],
  rejected: ['Rechazado', 'badge-red'],
  declined: ['Declinado', 'badge-gray'],
  cancelled: ['Cancelado', 'badge-gray'],
};

function LeaveModal({ onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ type: 'vacation', start_date: '', end_date: '', reason: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await post('/leave', { ...form, reason: form.reason || null });
      toast('Solicitud enviada');
      onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Solicitar ausencia"
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy || !form.start_date || !form.end_date}>Enviar solicitud</button>
      </>}
    >
      {error && <div className="inline-note err">{error}</div>}
      <div className="field">
        <label>Tipo</label>
        <select className="input" value={form.type} onChange={set('type')}>
          <option value="vacation">🌴 Vacaciones</option>
          <option value="sick">🤒 Baja médica</option>
          <option value="personal">👤 Asunto personal</option>
          <option value="other">📁 Otros</option>
        </select>
      </div>
      <div className="input-row">
        <div className="field">
          <label>Desde</label>
          <input className="input" type="date" value={form.start_date} onChange={set('start_date')} />
        </div>
        <div className="field">
          <label>Hasta</label>
          <input className="input" type="date" value={form.end_date} onChange={set('end_date')} />
        </div>
      </div>
      <div className="field">
        <label>Motivo (opcional)</label>
        <textarea className="input" value={form.reason} onChange={set('reason')} placeholder="Cuéntale a tu gestor lo esencial…" />
      </div>
    </Modal>
  );
}

export default function Requests() {
  const { user } = useAuth();
  const toast = useToast();
  const isManager = user.role !== 'employee';
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'swaps' ? 'swaps' : (isManager ? 'leave' : 'mine');
  const [tab, setTab] = useState(initialTab);
  const [leave, setLeave] = useState([]);
  const [claims, setClaims] = useState([]);
  const [swaps, setSwaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveImpact, setLeaveImpact] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [lv, cl, sw] = await Promise.all([get('/leave'), get('/claims'), get('/swaps')]);
      setLeave(lv.requests);
      setClaims(cl.claims);
      setSwaps(sw.swaps);
    } catch (e) {
      toast(e.message, 'err');
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const review = async (id, status, kind) => {
    try {
      await post(`/${kind}/${id}/review`, { status });
      toast(status === 'approved' ? '✅ Aprobada' : 'Rechazada');
      setLeaveImpact(null);
      load();
    } catch (e) {
      if (e.violations?.length) {
        toast(`${e.message}: ${e.violations[0]}`, 'err');
      } else {
        toast(e.message, 'err');
      }
    }
  };

  // Vista previa de cobertura antes de aprobar una ausencia
  const showImpact = async (leave) => {
    try {
      const data = await get(`/leave/${leave.id}/impact`);
      setLeaveImpact(data);
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const swapAction = async (id, action) => {
    try {
      await post(`/swaps/${id}/${action}`);
      toast({
        accept: 'Aceptaste — pendiente de aprobación del gestor',
        decline: 'Propuesta declinada',
        cancel: 'Propuesta retirada',
        approve: '✅ Cambio aprobado: turno reasignado',
        reject: 'Cambio rechazado',
      }[action] || 'Hecho');
      load();
    } catch (e) {
      if (e.violations?.length) toast(`${e.message}: ${e.violations[0]}`, 'err');
      else toast(e.message, 'err');
    }
  };

  const cancel = async (id, kind) => {
    try {
      await post(`/${kind}/${id}/cancel`);
      toast('Cancelada');
      load();
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const pendingLeave = leave.filter((l) => l.status === 'pending');
  const pendingClaims = claims.filter((c) => c.status === 'pending');
  const swapActionsForMe = swaps.filter((s) => s.status === 'pending' || (s.status === 'accepted' && isManager)).length;

  return (
    <>
      <Topbar title="Solicitudes">
        <button className="btn btn-primary btn-sm" onClick={() => setShowLeaveModal(true)}>+ Solicitar ausencia</button>
      </Topbar>
      <div className="content">
        <div className="tabs mb-20">
          {isManager ? (
            <>
              <button className={`tab ${tab === 'leave' ? 'active' : ''}`} onClick={() => setTab('leave')}>
                Ausencias {pendingLeave.length > 0 && <span className="badge badge-amber" style={{ marginLeft: 6 }}>{pendingLeave.length}</span>}
              </button>
              <button className={`tab ${tab === 'claims' ? 'active' : ''}`} onClick={() => setTab('claims')}>
                Reclamaciones {pendingClaims.length > 0 && <span className="badge badge-amber" style={{ marginLeft: 6 }}>{pendingClaims.length}</span>}
              </button>
              <button className={`tab ${tab === 'swaps' ? 'active' : ''}`} onClick={() => setTab('swaps')}>
                Cambios {swapActionsForMe > 0 && <span className="badge badge-amber" style={{ marginLeft: 6 }}>{swapActionsForMe}</span>}
              </button>
              <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>Historial</button>
            </>
          ) : (
            <>
              <button className={`tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>Mis ausencias</button>
              <button className={`tab ${tab === 'swaps' ? 'active' : ''}`} onClick={() => setTab('swaps')}>
                Cambios de turno {swapActionsForMe > 0 && <span className="badge badge-amber" style={{ marginLeft: 6 }}>{swapActionsForMe}</span>}
              </button>
            </>
          )}
        </div>

        {loading ? <Spinner /> : (
          <div className="card">
            {(tab === 'leave' || tab === 'history' || tab === 'mine') && (
              <table className="table">
                <thead>
                  <tr><th>Persona</th><th>Tipo</th><th>Fechas</th><th>Motivo</th><th>Estado</th><th /></tr>
                </thead>
                <tbody>
                  {(tab === 'history' ? leave : tab === 'mine' ? leave : pendingLeave).map((l) => {
                    const [label, cls] = STATUS_BADGE[l.status];
                    return (
                      <tr key={l.id}>
                        <td>
                          <span className="flex">
                            <Avatar name={l.user_name} color={l.user_color} />
                            <b>{l.user_name}</b>
                          </span>
                        </td>
                        <td><span className={`badge ${LEAVE_BADGE[l.type]}`}>{LEAVE_LABEL[l.type]}</span></td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.start_date)} → {fmtDate(l.end_date)}</td>
                        <td className="muted">{l.reason || '—'}</td>
                        <td><span className={`badge ${cls}`}>{label}</span></td>
                        <td>
                          <div className="row-actions">
                            {isManager && l.status === 'pending' && (
                              <>
                                <button className="btn btn-success btn-sm" onClick={() => showImpact(l)}>Aprobar…</button>
                                <button className="btn btn-danger btn-sm" onClick={() => review(l.id, 'rejected', 'leave')}>Rechazar</button>
                              </>
                            )}
                            {!isManager && l.status === 'pending' && (
                              <button className="btn btn-ghost btn-sm" onClick={() => cancel(l.id, 'leave')}>Cancelar</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {(tab === 'leave' ? pendingLeave : tab === 'mine' ? leave : []).length === 0 && (
                    <tr><td colSpan="6"><div className="empty"><div className="ico">🎉</div><b>Nada por aquí</b>{tab === 'mine' ? 'Aún no has solicitado ninguna ausencia' : 'Sin ausencias pendientes de revisar'}</div></td></tr>
                  )}
                </tbody>
              </table>
            )}

            {tab === 'claims' && (
              <table className="table">
                <thead>
                  <tr><th>Solicitante</th><th>Turno</th><th>Fecha</th><th>Estado</th><th /></tr>
                </thead>
                <tbody>
                  {claims.map((c) => {
                    const [label, cls] = STATUS_BADGE[c.status];
                    return (
                      <tr key={c.id}>
                        <td>
                          <span className="flex">
                            <Avatar name={c.user_name} color={c.user_color} />
                            <b>{c.user_name}</b>
                          </span>
                        </td>
                        <td><span className="time-pill">{c.start_time?.slice(0, 5)}–{c.end_time?.slice(0, 5)}</span></td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDateLong(c.date)}</td>
                        <td><span className={`badge ${cls}`}>{label}</span></td>
                        <td>
                          <div className="row-actions">
                            {isManager && c.status === 'pending' && (
                              <>
                                <button className="btn btn-success btn-sm" onClick={() => review(c.id, 'approved', 'claims')}>Asignar turno</button>
                                <button className="btn btn-danger btn-sm" onClick={() => review(c.id, 'rejected', 'claims')}>Rechazar</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {claims.length === 0 && (
                    <tr><td colSpan="5"><div className="empty"><div className="ico">🔓</div><b>Sin reclamaciones</b>Cuando alguien pida un turno abierto aparecerá aquí</div></td></tr>
                  )}
                </tbody>
              </table>
            )}

            {tab === 'swaps' && (
              <table className="table">
                <thead>
                  <tr><th>De</th><th>Para</th><th>Turno</th><th>Estado</th><th /></tr>
                </thead>
                <tbody>
                  {swaps.map((s) => {
                    const [label, cls] = SWAP_BADGE[s.status];
                    const incoming = s.to_user_id === user.id;
                    const outgoing = s.from_user_id === user.id;
                    return (
                      <tr key={s.id}>
                        <td><span className="flex"><Avatar name={s.from_name} color={s.from_color} /><b>{s.from_name}</b></span></td>
                        <td><span className="flex"><Avatar name={s.to_name} color={s.to_color} /><b>{s.to_name}</b></span></td>
                        <td>
                          <span className="time-pill">{t5(s.start_time)}–{t5(s.end_time)}</span>
                          <span style={{ marginLeft: 8 }}>{fmtDateLong(s.date)}</span>
                          {s.department_name && <span className="badge badge-gray" style={{ marginLeft: 8 }}>{s.department_name}</span>}
                        </td>
                        <td><span className={`badge ${cls}`}>{label}</span></td>
                        <td>
                          <div className="row-actions">
                            {incoming && s.status === 'pending' && (
                              <>
                                <button className="btn btn-success btn-sm" onClick={() => swapAction(s.id, 'accept')}>Aceptar</button>
                                <button className="btn btn-danger btn-sm" onClick={() => swapAction(s.id, 'decline')}>Declinar</button>
                              </>
                            )}
                            {isManager && s.status === 'accepted' && (
                              <>
                                <button className="btn btn-success btn-sm" onClick={() => swapAction(s.id, 'approve')}>Aprobar cambio</button>
                                <button className="btn btn-danger btn-sm" onClick={() => swapAction(s.id, 'reject')}>Rechazar</button>
                              </>
                            )}
                            {outgoing && ['pending', 'accepted'].includes(s.status) && (
                              <button className="btn btn-ghost btn-sm" onClick={() => swapAction(s.id, 'cancel')}>Retirar</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {swaps.length === 0 && (
                    <tr><td colSpan="5"><div className="empty"><div className="ico">🔁</div><b>Sin cambios de turno</b>Desde «Mis turnos» puedes proponer ceder un turno a un compañero</div></td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}

        {showLeaveModal && <LeaveModal onClose={() => setShowLeaveModal(false)} onSaved={() => { setShowLeaveModal(false); load(); }} />}

        {leaveImpact && (
          <Modal
            title="Impacto en la cobertura"
            onClose={() => setLeaveImpact(null)}
            width={560}
            footer={
              <>
                <button className="btn btn-ghost" onClick={() => setLeaveImpact(null)}>Cancelar</button>
                <button className="btn btn-danger" onClick={() => review(leaveImpact.leave.id, 'rejected', 'leave')}>Rechazar</button>
                <button className="btn btn-primary" onClick={() => review(leaveImpact.leave.id, 'approved', 'leave')}>✅ Confirmar aprobación</button>
              </>
            }
          >
            <p className="mb-14">
              <b>{leaveImpact.leave.person}</b> · {fmtDateLong(leaveImpact.leave.start_date)} → {fmtDateLong(leaveImpact.leave.end_date)}
            </p>
            {leaveImpact.shifts.length === 0 ? (
              <p className="muted">No tiene turnos asignados en ese periodo: aprobar no afecta al cuadrante.</p>
            ) : (
              <>
                <p className="mb-8">
                  Al aprobar se liberarán <b>{leaveImpact.shifts.length} turno(s)</b>, que quedarán abiertos para reclamación:
                </p>
                <div className="mb-14" style={{ maxHeight: 180, overflow: 'auto' }}>
                  {leaveImpact.shifts.map((s) => (
                    <div className="list-row" key={s.id}>
                      <span className="time-pill">{t5(s.start_time)}–{t5(s.end_time)}</span>
                      <b>{fmtDateLong(s.date)}</b>
                      <span className="spacer" />
                      {s.department_name && <span className="badge badge-gray">{s.department_name}</span>}
                      {s.schedule_status === 'draft' && <span className="badge badge-amber">borrador</span>}
                    </div>
                  ))}
                </div>
                <p className="mb-8" style={{ fontWeight: 700, fontSize: 13.5 }}>Cobertura que quedaría esos días:</p>
                {leaveImpact.by_date.map((d) => (
                  <div className="list-row" key={d.date}>
                    <b>{fmtDate(d.date)}</b>
                    <span className="spacer" />
                    {d.departments.map((dep, i) => (
                      <span key={i} className={`badge ${dep.remaining === 0 ? 'badge-red' : dep.remaining <= 1 ? 'badge-amber' : 'badge-green'}`}>
                        {dep.department}: {dep.remaining} persona{dep.remaining === 1 ? '' : 's'}
                      </span>
                    ))}
                  </div>
                ))}
                {leaveImpact.warnings.length > 0 && (
                  <div className="inline-note err" style={{ marginTop: 12 }}>
                    <b>⚠️ Riesgo de descobertura:</b>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {leaveImpact.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </>
            )}
          </Modal>
        )}
      </div>
    </>
  );
}
