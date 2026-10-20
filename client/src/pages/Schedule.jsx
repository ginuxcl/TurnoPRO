import { useCallback, useEffect, useMemo, useState } from 'react';
import { Topbar } from '../components/Layout.jsx';
import Calendar from '../components/Calendar.jsx';
import Spreadsheet from '../components/Spreadsheet.jsx';
import ShiftModal from '../components/ShiftModal.jsx';
import { get, post, patch } from '../api.js';
import { useToast, fmtDate, addDays, weekStart, todayStr, Spinner, Modal } from '../ui.jsx';

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Revisión previa de un comando: nada se aplica sin confirmar (estilo Deputy)
function CmdPreviewModal({ preview, applyBusy, onClose, onApply }) {
  const [sel, setSel] = useState(() => preview.changes.map(() => true));
  const chosen = preview.changes.filter((_, i) => sel[i]);
  const toggle = (i) => setSel((s) => s.map((v, j) => (j === i ? !v : v)));
  return (
    <Modal title="Revisa los cambios propuestos" onClose={onClose} width={620}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={applyBusy || !chosen.length} onClick={() => onApply(chosen)}>
            {applyBusy ? 'Aplicando…' : `✓ Aplicar ${chosen.length} cambio${chosen.length === 1 ? '' : 's'}`}
          </button>
        </>
      }>
      <p className="mb-8"><b>{preview.summary}</b></p>
      <p className="hint mb-14">Nada se aplica hasta que lo confirmes. Cada cambio se revalida contra las reglas; los que fallen se te reportan.</p>
      <div style={{ maxHeight: 320, overflow: 'auto' }}>
        {preview.changes.map((c, i) => (
          <label key={i} className="list-row" style={{ cursor: 'pointer', alignItems: 'flex-start' }}>
            <input type="checkbox" checked={sel[i]} onChange={() => toggle(i)} style={{ marginTop: 3 }} />
            <span style={{ fontSize: 13 }}>{c.label}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

export default function Schedule() {
  const toast = useToast();
  const [ws, setWs] = useState(weekStart(todayStr()));
  const [mode, setMode] = useState('week'); // week | month | grid
  const [monthRef, setMonthRef] = useState(todayStr().slice(0, 7)); // YYYY-MM
  const [shifts, setShifts] = useState([]);
  const [schedules, setSchedules] = useState({});
  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [leave, setLeave] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [patternPick, setPatternPick] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ dep: '', person: '' });
  const [modal, setModal] = useState(null); // {shift?} | {date, time}
  const [publishInfo, setPublishInfo] = useState(null);
  const [autofillInfo, setAutofillInfo] = useState(null);
  const [weekBusy, setWeekBusy] = useState(false);

  const weekEnd = addDays(ws, 6);
  // Rango a pedir según el modo (el mes completo, con márgenes)
  const range = useMemo(() => {
    if (mode === 'week' || mode === 'grid') return { from: ws, to: weekEnd };
    const [y, m] = monthRef.split('-').map(Number);
    const first = `${monthRef}-01`;
    const last = new Date(y, m, 0).getDate();
    return { from: first, to: `${monthRef}-${String(last).padStart(2, '0')}` };
  }, [mode, ws, monthRef, weekEnd]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sh, sc, st, dp, tp, lv, hl] = await Promise.all([
        get(`/shifts?from=${range.from}&to=${range.to}${filters.person === 'open' ? '&user_id=open' : filters.person ? `&user_id=${filters.person}` : ''}${filters.dep ? `&department_id=${filters.dep}` : ''}`),
        get(`/schedules?from=${range.from}&to=${range.to}`),
        get('/staff'),
        get('/departments'),
        get('/templates'),
        get('/leave?status=approved'),
        get(`/holidays?from=${range.from}&to=${range.to}`),
      ]);
      setShifts(sh.shifts);
      setSchedules(Object.fromEntries(sc.schedules.map((s) => [s.week_start, s])));
      setStaff(st.staff);
      setDepartments(dp.departments);
      setTemplates(tp.templates);
      setLeave(lv.requests);
      setHolidays(hl.holidays);
    } catch (e) {
      toast(e.message, 'err');
    }
    setLoading(false);
  }, [ws, mode, monthRef, filters, toast, range]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    get('/patterns').then((d) => setPatterns(d.patterns)).catch(() => {});
  }, []);

  const schedule = mode === 'month' ? null : schedules[ws];
  const isPublished = schedule?.status === 'published';

  const leaveByDate = useMemo(() => {
    const map = {};
    for (const l of leave) {
      for (let d = l.start_date; d <= l.end_date && d <= addDays(range.to, 3); d = addDays(d, 1)) {
        (map[d] ||= []).push({ name: l.user_name.split(' ')[0], color: l.user_color });
      }
    }
    return map;
  }, [leave, range]);

  const holidaysByDate = useMemo(() => Object.fromEntries(holidays.map((h) => [h.date, h.name])), [holidays]);

  const nav = (delta) => {
    if (mode === 'week') setWs((w) => addDays(w, delta * 7));
    else {
      const [y, m] = monthRef.split('-').map(Number);
      const d = new Date(y, m - 1 + delta, 1);
      setMonthRef(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
  };
  const goToday = () => { setWs(weekStart(todayStr())); setMonthRef(todayStr().slice(0, 7)); };

  const onDropShift = async (shiftId, newDate) => {
    const s = shifts.find((x) => x.id === shiftId);
    if (!s || s.date === newDate) return;
    try {
      await patch(`/shifts/${shiftId}`, { date: newDate });
      toast('Turno movido');
      load();
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const setWeekStatus = async (status) => {
    if (!schedule) return;
    setWeekBusy(true);
    try {
      const r = await post(`/schedules/${schedule.id}/status`, { status });
      if (status === 'published' && r.warnings?.length) {
        setPublishInfo(r.warnings);
      } else {
        toast(status === 'published' ? '✅ Horario publicado: el equipo ya lo ve' : 'Horario devuelto a borrador');
      }
      load();
    } catch (e) {
      toast(e.message, 'err');
    }
    setWeekBusy(false);
  };

  const copyNext = async () => {
    setWeekBusy(true);
    try {
      const r = await post(`/schedules/${schedule.id}/copy-next`);
      toast(`Semana siguiente creada con ${r.copied} turnos`);
      setWs(addDays(ws, 7));
    } catch (e) {
      toast(e.message, 'err');
    }
    setWeekBusy(false);
  };

  const autofill = async () => {
    if (!schedule) return;
    if (!confirm('¿Asignar automáticamente los turnos abiertos de esta semana? Se respetan ausencias, disponibilidad y reglas.')) return;
    setWeekBusy(true);
    try {
      const r = await post(`/schedules/${schedule.id}/autofill`, { strategy: autofillStrategy });
      setAutofillInfo(r);
      load();
    } catch (e) {
      toast(e.message, 'err');
    }
    setWeekBusy(false);
  };

  // ---- Comandos del cuadrante (estilo Deputy: proponer → revisar → aplicar) ----
  const [cmd, setCmd] = useState('');
  const [cmdBusy, setCmdBusy] = useState(false);
  const [cmdPreview, setCmdPreview] = useState(null); // { summary, changes }
  const [cmdAnswer, setCmdAnswer] = useState(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [autofillStrategy, setAutofillStrategy] = useState('balanced');

  const runCommand = async (e) => {
    e?.preventDefault?.();
    const q = cmd.trim();
    if (!q || cmdBusy) return;
    setCmdBusy(true);
    try {
      const r = await post('/assistant/command', { question: q, week_start: ws });
      if (r.kind === 'preview') setCmdPreview(r);
      else setCmdAnswer(r.answer);
      setCmd('');
    } catch (err) {
      toast(err.message, 'err');
    }
    setCmdBusy(false);
  };

  const applyCommand = async (changes) => {
    setApplyBusy(true);
    try {
      const r = await post('/assistant/apply', { changes });
      const failedTxt = r.failed?.length ? ` · ${r.failed.length} sin aplicar: ${r.failed[0].reason}` : '';
      toast(`✅ ${r.applied} cambio(s) aplicado(s)${failedTxt}`, r.failed?.length ? 'warn' : 'ok');
      setCmdPreview(null);
      load();
    } catch (e) {
      toast(e.message, 'err');
    }
    setApplyBusy(false);
  };

  // Coste estimado de la semana visible (transparencia antes de publicar)
  const weekCost = useMemo(() => {
    let total = 0, known = false;
    for (const s of shifts) {
      const p = staff.find((u) => u.id === s.user_id);
      if (!p || p.hourly_rate == null) continue;
      known = true;
      const mins = (s.duration_minutes || 0) - (s.break_minutes || 0);
      total += (mins / 60) * Number(p.hourly_rate);
    }
    return known ? Math.round(total) : null;
  }, [shifts, staff]);

  const openShiftsCount = shifts.filter((s) => !s.user_id).length;

  const applyPattern = async (pattern, force) => {
    setWeekBusy(true);
    try {
      const r = await post(`/patterns/${pattern.id}/apply`, { week_start: ws, force });
      toast(`Patrón "${pattern.name}" aplicado: ${r.created} turnos creados${r.skipped ? `, ${r.skipped} omitidos` : ''}`);
      setPatternPick(null);
      load();
    } catch (e) {
      if (e.code === 'PUBLISHED') {
        if (confirm('La semana ya está publicada. ¿Añadir los turnos del patrón encima?')) {
          setWeekBusy(false);
          return applyPattern(pattern, true);
        }
      } else {
        toast(e.message, 'err');
      }
    }
    setWeekBusy(false);
  };

  const weekLabel = mode === 'week'
    ? `${fmtDate(ws)} — ${fmtDate(weekEnd)}, ${ws.slice(0, 4)}`
    : (() => { const [y, m] = monthRef.split('-').map(Number); return `${MONTH_NAMES[m - 1][0].toUpperCase() + MONTH_NAMES[m - 1].slice(1)} ${y}`; })();
  const weekMins = shifts.reduce((a, s) => a + (s.duration_minutes || 0), 0);

  return (
    <>
      <Topbar title="Planificar turnos">
        {schedule && (
          <span className={`badge ${isPublished ? 'badge-green' : 'badge-amber'}`}>
            {isPublished ? '● Publicado' : '● Borrador'}
          </span>
        )}
        <div className="tabs">
          <button className={`tab ${mode === 'week' ? 'active' : ''}`} onClick={() => setMode('week')}>Semana</button>
          <button className={`tab ${mode === 'month' ? 'active' : ''}`} onClick={() => setMode('month')}>Mes</button>
          <button className={`tab ${mode === 'grid' ? 'active' : ''}`} onClick={() => setMode('grid')}>Cuadrante</button>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={goToday}>Hoy</button>
      </Topbar>
      <div className="content">
        {mode !== 'month' && (
          <form className="cmd-bar" onSubmit={runCommand}>
            <span className="cmd-ico">✨</span>
            <input
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              placeholder='Pide lo que necesites… «extiende los turnos de cocina del viernes una hora» · «busca sustituto para Lucía» · «¿listo para la nómina?»'
              maxLength={300}
            />
            <button className="btn btn-primary" disabled={cmdBusy || !cmd.trim()}>
              {cmdBusy ? <Spinner /> : 'Enviar'}
            </button>
          </form>
        )}
        <div className="cal-toolbar">
          <div className="left">
            <button className="btn btn-ghost btn-icon" onClick={() => nav(-1)} aria-label="Anterior">‹</button>
            <div className="week-label">
              {weekLabel}
              <small>
                {shifts.length} turnos · {Math.round((weekMins / 60) * 10) / 10} h planificadas
                {weekCost != null ? ` · ≈ ${weekCost.toLocaleString('es-ES')} €` : ''}
                {mode !== 'month' && openShiftsCount > 0 ? ` · ${openShiftsCount} abiertos` : ''}
              </small>
            </div>
            <button className="btn btn-ghost btn-icon" onClick={() => nav(1)} aria-label="Siguiente">›</button>
          </div>
          <div className="right">
            <select className="input" style={{ width: 160 }} value={filters.dep} onChange={(e) => setFilters((f) => ({ ...f, dep: e.target.value }))}>
              <option value="">Todos los deptos.</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select className="input" style={{ width: 160 }} value={filters.person} onChange={(e) => setFilters((f) => ({ ...f, person: e.target.value }))}>
              <option value="">Todo el equipo</option>
              <option value="open">🔓 Solo abiertos</option>
              {staff.filter((p) => p.is_active).map((p) => (
                <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
              ))}
            </select>
            {(mode === 'week' || mode === 'grid') && schedule && (
              <>
                <button className="btn btn-soft" onClick={() => setPatternPick('pick')} disabled={weekBusy} title="Crear la semana a partir de una plantilla semanal (rotaciones 5x2, 7x7…)">
                  🔁 Aplicar patrón
                </button>
                {openShiftsCount > 0 && (
                  <>
                    <select className="input" style={{ width: 150 }} value={autofillStrategy} onChange={(e) => setAutofillStrategy(e.target.value)} title="Prioridad del autocompletado">
                      <option value="balanced">⚖️ Equidad</option>
                      <option value="cost">💰 Menor coste</option>
                      <option value="past">🔁 Semana pasada</option>
                    </select>
                    <button className="btn btn-soft" onClick={autofill} disabled={weekBusy} title="Asignar automáticamente respetando ausencias, disponibilidad y reglas">
                      ⚡ Autocompletar
                    </button>
                  </>
                )}
                <button className="btn btn-ghost" onClick={copyNext} disabled={weekBusy}>⧉ Copiar a siguiente</button>
                {isPublished ? (
                  <button className="btn btn-ghost" onClick={() => setWeekStatus('draft')} disabled={weekBusy}>Despublicar</button>
                ) : (
                  <button className="btn btn-primary" onClick={() => setWeekStatus('published')} disabled={weekBusy || !shifts.length}>
                    🚀 Publicar
                  </button>
                )}
              </>
            )}
            {mode !== 'month' && <button className="btn btn-primary" onClick={() => setModal({ date: ws, time: '09:00' })}>+ Turno</button>}
          </div>
        </div>

        {publishInfo && (
          <Modal title={publishInfo.some((w) => w.kind === 'rule') ? 'Publicado con avisos de cumplimiento' : 'Horario publicado con avisos'} onClose={() => setPublishInfo(null)}
            footer={<button className="btn btn-primary" onClick={() => setPublishInfo(null)}>Entendido</button>}>
            <p className="mb-14">El horario se ha publicado, pero hay puntos que revisar:</p>
            {publishInfo.map((w, i) => (
              <div className="list-row" key={i}>
                {w.kind === 'leave'
                  ? <><span className="badge badge-amber">🌴 Ausencia</span><span><b>{w.person}</b> — turno del {fmtDate(w.date)}</span></>
                  : <><span className="badge badge-red">⚠️ Regla</span><span>{w.message}</span></>}
              </div>
            ))}
          </Modal>
        )}

        {autofillInfo && (
          <Modal title="⚡ Autocompletado listo" onClose={() => setAutofillInfo(null)}
            footer={<button className="btn btn-primary" onClick={() => setAutofillInfo(null)}>Perfecto</button>}>
            <p className="mb-14">
              Se asignaron <b>{autofillInfo.assigned}</b> turnos respetando ausencias, disponibilidad y reglas
              {autofillInfo.still_open > 0 && <> — <b>{autofillInfo.still_open}</b> siguen abiertos (nadie elegible: revisa reglas o disponibilidad)</>}.
            </p>
            {Object.entries(autofillInfo.by_person).map(([name, n]) => (
              <div className="list-row" key={name}><b>{name}</b><span className="spacer" /><span className="badge badge-sky">+{n} turno{n > 1 ? 's' : ''}</span></div>
            ))}
          </Modal>
        )}

        {cmdPreview && (
          <CmdPreviewModal preview={cmdPreview} applyBusy={applyBusy} onClose={() => setCmdPreview(null)} onApply={applyCommand} />
        )}

        {cmdAnswer && (
          <Modal title="✨ Respuesta" onClose={() => setCmdAnswer(null)}
            footer={<button className="btn btn-primary" onClick={() => setCmdAnswer(null)}>Entendido</button>}>
            <p style={{ whiteSpace: 'pre-line', fontSize: 14 }}>{cmdAnswer}</p>
          </Modal>
        )}

        {patternPick && (
          <Modal title="Aplicar patrón de semana" onClose={() => setPatternPick(null)}
            footer={<button className="btn btn-soft" onClick={() => setPatternPick(null)}>Cerrar</button>}>
            {patterns.length === 0 && (
              <div className="empty"><div className="ico">🔁</div><b>Todavía no tienes patrones</b>Crea plantillas semanales (5x2, 7x7…) en Ajustes</div>
            )}
            <p className="muted mb-14" style={{ fontSize: 13 }}>
              Se crearán los turnos del patrón en la semana del {fmtDate(ws)}. Si una persona ya tuviera ese turno, se omite.
            </p>
            {patterns.map((p) => {
              const total = p.days.reduce((a, d) => a + d.length, 0);
              return (
                <div className="list-row" key={p.id}>
                  <div>
                    <b>{p.name}</b>
                    <div className="muted" style={{ fontSize: 12 }}>{total} turnos/semana</div>
                  </div>
                  <span className="spacer" />
                  <button className="btn btn-primary btn-sm" disabled={weekBusy} onClick={() => applyPattern(p, false)}>Aplicar</button>
                </div>
              );
            })}
          </Modal>
        )}

        {loading ? <Spinner /> : mode === 'grid' ? (
          <Spreadsheet
            weekStart={ws}
            shifts={shifts}
            staff={staff}
            onShiftClick={(sh) => setModal({ shift: sh })}
            onCellClick={(date, userId) => setModal({ date, time: '09:00', presetUser: userId })}
          />
        ) : (
          <Calendar
            weekStart={ws}
            monthFrom={`${monthRef}-01`}
            mode={mode}
            shifts={shifts}
            draggable={mode === 'week'}
            onSlotClick={(date, time) => setModal({ date, time })}
            onShiftClick={(s) => setModal({ shift: s })}
            onDropShift={onDropShift}
            leaveByDate={leaveByDate}
            holidaysByDate={holidaysByDate}
            onMonthCellClick={(date) => setModal({ date, time: '09:00' })}
          />
        )}
        <p className="hint mt-14" style={{ textAlign: 'center' }}>
          {mode === 'week'
            ? 'Clic en un hueco para crear un turno · clic en un turno para editarlo · arrastra un turno a otro día para moverlo'
            : mode === 'grid'
              ? 'Cuadrante: clic en una celda vacía para asignar un turno a esa persona · clic en un turno para editarlo'
              : 'Vista mensual: clic en un día para crear un turno ese día'}
        </p>

        {modal && (
          <ShiftModal
            shift={modal.shift}
            date={modal.date}
            time={modal.time}
            presetUser={modal.presetUser}
            staff={staff}
            departments={departments}
            templates={templates}
            onClose={() => setModal(null)}
            onSaved={() => { setModal(null); load(); }}
            onDeleted={() => { setModal(null); load(); }}
          />
        )}
      </div>
    </>
  );
}
