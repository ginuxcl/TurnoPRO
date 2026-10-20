import { useCallback, useEffect, useMemo, useState } from 'react';
import { Topbar } from '../components/Layout.jsx';
import { Spinner } from '../ui.jsx';
import { get, download } from '../api.js';

const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const hs = (min) => (Math.round((min / 60) * 100) / 100).toLocaleString('es-ES', { maximumFractionDigits: 1 });
const eur = (v) => (v == null ? '—' : v.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }));

function monthStarts() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      label: d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }),
      from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`,
      to: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()).padStart(2, '0')}`,
    });
  }
  return out;
}

export default function Reports() {
  const [deps, setDeps] = useState([]);
  const [dep, setDep] = useState('');
  const months = useMemo(monthStarts, []);
  const [range, setRange] = useState({ from: months[0].from, to: months[0].to });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { get('/departments').then((d) => setDeps(d.departments)).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = `from=${range.from}&to=${range.to}${dep ? `&department_id=${dep}` : ''}`;
      setData(await get(`/reports/hours?${q}`));
    } catch { /* noop */ }
    setLoading(false);
  }, [range, dep]);

  useEffect(() => { load(); }, [load]);

  const doExport = async () => {
    setExporting(true);
    try {
      const q = `from=${range.from}&to=${range.to}${dep ? `&department_id=${dep}` : ''}`;
      await download(`/reports/export.xlsx?${q}`, `turnos_${range.from}_${range.to}.xlsx`);
    } catch { /* noop */ }
    setExporting(false);
  };

  return (
    <>
      <Topbar title="Reportes y costes">
        <button className="btn btn-primary" onClick={doExport} disabled={exporting || !data}>
          {exporting ? <Spinner size={14} /> : '⬇'} Exportar Excel
        </button>
      </Topbar>
      <div className="page">
        <div className="card">
          <div className="filters-row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
              Desde
              <input type="date" className="input" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
              Hasta
              <input type="date" className="input" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--muted)' }}>
              Departamento
              <select className="input" value={dep} onChange={(e) => setDep(e.target.value)}>
                <option value="">Todos</option>
                {deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              {months.slice(0, 4).map((m) => (
                <button
                  key={m.from}
                  className={`btn btn-sm ${range.from === m.from ? 'btn-primary' : 'btn-soft'}`}
                  onClick={() => setRange({ from: m.from, to: m.to })}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading && <div className="card"><div style={{ display: 'grid', placeItems: 'center', padding: 40 }}><Spinner /></div></div>}

        {!loading && data && (
          <>
            <div className="stat-grid">
              <div className="card stat-card"><span className="lbl">Turnos</span><span className="val">{data.totals.shift_count}</span></div>
              <div className="card stat-card"><span className="lbl">Horas planificadas</span><span className="val">{hs(data.totals.planned_minutes)} h</span></div>
              <div className="card stat-card"><span className="lbl">Horas fichadas</span><span className="val">{hs(data.totals.actual_minutes)} h</span></div>
              <div className="card stat-card"><span className="lbl">Coste estimado</span><span className="val">{eur(data.totals.cost || null)}</span></div>
            </div>

            <div className="card">
              <table className="table">
                <thead>
                  <tr>
                    <th>Persona</th>
                    <th>Turnos</th>
                    <th>Horas planificadas</th>
                    <th>Horas fichadas</th>
                    <th>Desviación</th>
                    <th>Valor hora</th>
                    <th>Coste</th>
                    <th>Desglose</th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((p) => {
                    const dev = p.actual_minutes - p.planned_minutes;
                    return (
                      <tr key={p.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="dot" style={{ background: p.color }} />
                            <b>{p.first_name} {p.last_name}</b>
                            <span className="muted" style={{ fontSize: 12 }}>{p.position || ''}</span>
                          </div>
                        </td>
                        <td>{p.shift_count}</td>
                        <td>{hs(p.planned_minutes)} h</td>
                        <td>{hs(p.actual_minutes)} h</td>
                        <td style={{ color: Math.abs(dev) <= 15 ? 'inherit' : dev > 0 ? '#d97706' : '#dc2626' }}>
                          {p.actual_minutes === 0 ? '—' : `${dev > 0 ? '+' : ''}${hs(Math.abs(dev))} h`}
                        </td>
                        <td>{p.hourly_rate != null ? `${Number(p.hourly_rate).toFixed(2)} €/h` : '—'}</td>
                        <td><b>{eur(p.cost)}</b></td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {p.by_department.map((d, i) => (
                              d && (
                                <span key={i} className="chip" style={{ background: `${d.color}22`, color: d.color }}>
                                  {d.name} {hs(d.minutes)} h
                                </span>
                              )
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td><b>Total</b></td>
                    <td><b>{data.totals.shift_count}</b></td>
                    <td><b>{hs(data.totals.planned_minutes)} h</b></td>
                    <td><b>{hs(data.totals.actual_minutes)} h</b></td>
                    <td />
                    <td />
                    <td><b>{eur(data.totals.cost || null)}</b></td>
                    <td />
                  </tr>
                </tfoot>
              </table>
              {!data.people.length && <div className="empty"><div className="ico">📊</div><b>Sin datos en el rango</b>Prueba con otro periodo</div>}
            </div>
          </>
        )}
      </div>
    </>
  );
}
