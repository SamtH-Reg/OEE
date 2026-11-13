import { useEffect, useMemo, useState } from 'react';
import { api } from './api';

// Panel de análisis de paradas: resumen ejecutivo, Pareto por causa, por equipo,
// por línea, por día y turno, más el historial de cada equipo con la acción
// (reparación / cambio de equipo) que se le anotó. Todo sale de registro_paradas.

const fmt = (m) => {
  const min = Math.max(0, Math.round(m || 0));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
};
const hhmm = (iso) => new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
const dia = (iso) => new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
const fechaHora = (iso) => `${dia(iso)} ${hhmm(iso)}`;

const isoDia = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const hoy = isoDia(new Date());
const haceDias = (n) => {
  const x = new Date();
  x.setDate(x.getDate() - n);
  return isoDia(x);
};

const TIPOS = [
  { id: 'reparacion', texto: 'Reparación' },
  { id: 'cambio_equipo', texto: 'Cambio de equipo' },
  { id: 'ajuste', texto: 'Ajuste' },
  { id: 'otro', texto: 'Otro' }
];

export default function Analisis({ onClose }) {
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [linea, setLinea] = useState('');
  const [equipo, setEquipo] = useState(null);      // { id, nombre }
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [anotando, setAnotando] = useState(null);  // parada donde se anota
  const [form, setForm] = useState({ tipo: 'reparacion', detalle: '', responsable: '' });
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const d = await api.analisis({
        desde: `${desde}T00:00:00`,
        hasta: `${hasta}T23:59:59`,
        linea_id: linea || null,
        maquina_id: equipo?.id || null
      });
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => { cargar(); }, [desde, hasta, linea, equipo]);

  const resumenTexto = useMemo(() => {
    if (!data) return '';
    const r = data.resumen;
    if (!r.paradas && !r.planificadas) return 'No hay paradas registradas en el rango elegido.';
    const causas = data.porCausa.slice(0, 3);
    const top = causas[0];
    const dosPrimeras = causas.slice(0, 2).reduce((s, c) => s + c.pct, 0);
    const equipos = data.porEquipo.slice(0, 3);
    const partes = [];
    const mismoDia = dia(data.rango.desde) === dia(data.rango.hasta);
    if (r.paradas) {
      partes.push(mismoDia
        ? `El ${dia(data.rango.desde)} se registraron ${r.paradas} parada${r.paradas === 1 ? '' : 's'} por ${fmt(r.minutos)} en ${r.equipos} equipo${r.equipos === 1 ? '' : 's'}.`
        : `Entre el ${dia(data.rango.desde)} y el ${dia(data.rango.hasta)} se registraron ${r.paradas} paradas por ${fmt(r.minutos)} en ${r.equipos} equipos.`);
    } else {
      partes.push(mismoDia
        ? `El ${dia(data.rango.desde)} no hubo paradas que cuenten como pérdida.`
        : `Entre el ${dia(data.rango.desde)} y el ${dia(data.rango.hasta)} no hubo paradas que cuenten como pérdida.`);
    }
    if (top) partes.push(`La causa principal fue «${top.causa}» con ${fmt(top.minutos)} (${top.pct}% del tiempo)${dosPrimeras > 0 ? `, y entre las dos primeras causas se explica el ${dosPrimeras}%` : ''}.`);
    if (equipos.length) partes.push(`Los equipos más afectados: ${equipos.map(e => `${e.nombre} (${fmt(e.minutos)})`).join(', ')}.`);
    if (r.planificadas) {
      partes.push(`Se registraron además ${r.planificadas} parada${r.planificadas === 1 ? ' planificada' : 's planificadas'} (${fmt(r.minutos_planificados)}), que no ${r.planificadas === 1 ? 'cuenta' : 'cuentan'} como tiempo perdido.`);
    }
    if (r.abiertas) partes.push(`${r.abiertas} ${r.abiertas === 1 ? 'sigue abierta' : 'siguen abiertas'} al momento del informe.`);
    return partes.join(' ');
  }, [data]);

  function rangoRapido(dias) {
    setDesde(haceDias(dias - 1));
    setHasta(hoy);
    setEquipo(null);
  }

  function exportarCSV() {
    if (!data) return;
    const filas = [];
    filas.push(['Rango', `${desde} a ${hasta}`]);
    if (linea) filas.push(['Línea', data.lineas.find(l => String(l.id) === String(linea))?.nombre || linea]);
    if (equipo) filas.push(['Equipo', equipo.nombre]);
    filas.push([]);
    filas.push(['Resumen', 'valor']);
    filas.push(['Paradas', data.resumen.paradas]);
    filas.push(['Minutos perdidos', data.resumen.minutos]);
    filas.push(['Equipos afectados', data.resumen.equipos]);
    filas.push(['Parada más larga (min)', data.resumen.peor]);
    filas.push(['Paradas abiertas', data.resumen.abiertas]);
    filas.push(['Paradas planificadas', data.resumen.planificadas]);
    filas.push(['Minutos planificados (fuera del Pareto)', data.resumen.minutos_planificados]);
    filas.push([]);
    filas.push(['Por causa', 'Categoría', 'Paradas', 'Minutos', '% del total', '% acumulado']);
    for (const c of data.porCausa) filas.push([c.causa, c.categoria, c.paradas, c.minutos, c.pct, c.acum]);
    filas.push([]);
    filas.push(['Por equipo', 'Área', 'Líneas', 'Paradas', 'Minutos', 'Última parada']);
    for (const e of data.porEquipo) {
      filas.push([e.nombre, e.area, e.lineas || '', e.paradas, e.minutos, e.ultima ? fechaHora(e.ultima) : '']);
    }
    filas.push([]);
    filas.push(['Por línea', 'Paradas', 'Minutos']);
    for (const l of data.porLinea) filas.push([l.nombre, l.paradas, l.minutos]);
    filas.push([]);
    filas.push(['Historial', 'Equipo', 'Área', 'Línea', 'Causa', 'Categoría', 'Inicio', 'Fin', 'Minutos', 'Acción', 'Resp.']);
    for (const p of data.historial) {
      const acc = (p.acciones || []).map(a => `${a.tipo}: ${a.detalle || ''}`).join(' | ');
      const resp = (p.acciones || []).map(a => a.responsable || '').filter(Boolean).join(' | ');
      filas.push([p.id, p.maquina, p.area, p.linea || '', p.causa, p.categoria,
                  fechaHora(p.hora_inicio), p.hora_fin ? fechaHora(p.hora_fin) : 'abierta',
                  p.minutos, acc, resp]);
    }
    const csv = filas.map(f => f.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `analisis-paradas-${desde}_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function guardarAccion() {
    if (!anotando || !form.detalle.trim()) return;
    setGuardando(true);
    try {
      await api.accionParada(anotando.id, form);
      setAnotando(null);
      setForm({ tipo: 'reparacion', detalle: '', responsable: '' });
      await cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  const r = data?.resumen;
  const maxCausa = Math.max(1, ...(data?.porCausa || []).map(c => c.minutos));
  const maxEquipo = Math.max(1, ...(data?.porEquipo || []).map(e => e.minutos));
  const dias = data?.porDia || [];
  const maxDia = Math.max(1, ...dias.map(d => d.minutos));

  return (
    <div className="analisis">
      <div className="an-top">
        <div>
          <div className="an-kicker">Registro y mejora operacional</div>
          <h1>Análisis de paradas</h1>
          <p>
            {data ? `${dia(data.rango.desde)} – ${dia(data.rango.hasta)}` : 'cargando…'}
            {linea && data ? ` · ${data.lineas.find(l => String(l.id) === String(linea))?.nombre || ''}` : ''}
            {equipo ? ` · ${equipo.nombre}` : ''}
          </p>
        </div>
        <div className="an-acciones">
          <button className="ghost" onClick={exportarCSV} disabled={!data}>Exportar CSV</button>
          <button className="ghost" onClick={() => window.print()} disabled={!data}>Imprimir / PDF</button>
          <button className="x" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
      </div>

      <div className="an-filtros">
        <label>Desde<input type="date" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} /></label>
        <label>Hasta<input type="date" value={hasta} min={desde} onChange={e => setHasta(e.target.value)} /></label>
        <label>Línea
          <select value={linea} onChange={e => { setLinea(e.target.value); setEquipo(null); }}>
            <option value="">Todas</option>
            {(data?.lineas || []).map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </label>
        <div className="an-rapidos">
          <button className="chip" onClick={() => rangoRapido(1)}>Hoy</button>
          <button className="chip" onClick={() => rangoRapido(7)}>7 días</button>
          <button className="chip" onClick={() => rangoRapido(30)}>30 días</button>
          {equipo && (
            <button className="chip on" onClick={() => setEquipo(null)}>Equipo: {equipo.nombre} ✕</button>
          )}
        </div>
      </div>

      {error && <div className="aviso error">{error}</div>}
      {cargando && !data && <div className="an-cargando">Cargando análisis…</div>}

      {data && (
        <>
          <section className="an-card an-resumen">
            <span>Resumen ejecutivo</span>
            <p className="an-texto">{resumenTexto}</p>
            <div className="an-kpis">
              <div className="an-kpi"><b>{fmt(r.minutos)}</b><small>tiempo perdido</small></div>
              <div className="an-kpi"><b>{r.paradas}</b><small>paradas</small></div>
              <div className="an-kpi"><b>{r.equipos}</b><small>equipos afectados</small></div>
              <div className="an-kpi"><b>{fmt(r.peor)}</b><small>parada más larga</small></div>
              <div className="an-kpi"><b>{r.abiertas}</b><small>abiertas ahora</small></div>
              <div className="an-kpi">
                <b>{r.planificadas}</b>
                <small>planificadas · {fmt(r.minutos_planificados)} fuera del Pareto</small>
              </div>
            </div>
          </section>

          <div className="an-grid">
            <section className="an-card">
              <span>Pareto por causa</span>
              {data.porCausa.length === 0 && <p className="an-vacio">Sin paradas en el rango.</p>}
              <div className="an-barras">
                {data.porCausa.slice(0, 10).map(c => (
                  <div className="an-barra" key={c.causa + c.categoria}>
                    <div className="an-barra-txt">
                      <b>{c.causa}</b>
                      <small>{c.categoria}{c.es_planificada ? ' · planificada' : ''}</small>
                    </div>
                    <div className="an-pista">
                      <i style={{ width: `${Math.max(3, (c.minutos / maxCausa) * 100)}%` }}
                         className={c.es_planificada ? 'plan' : ''} />
                    </div>
                    <div className="an-cifras"><b>{fmt(c.minutos)}</b><small>{c.pct}%</small></div>
                  </div>
                ))}
              </div>
              {data.porCausa.length > 0 && (
                <table className="an-tabla compacta">
                  <thead><tr><th>Causa</th><th>Paradas</th><th>Min</th><th>%</th><th>Acum.</th></tr></thead>
                  <tbody>
                    {data.porCausa.map(c => (
                      <tr key={'t' + c.causa + c.categoria}>
                        <td>{c.causa}</td><td>{c.paradas}</td><td>{c.minutos}</td>
                        <td>{c.pct}%</td><td>{c.acum}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="an-card">
              <span>Por equipo</span>
              {data.porEquipo.length === 0 && <p className="an-vacio">Sin paradas en el rango.</p>}
              <table className="an-tabla">
                <thead>
                  <tr><th>Equipo</th><th>Área</th><th>Paradas</th><th>Tiempo</th><th>Última</th><th></th></tr>
                </thead>
                <tbody>
                  {data.porEquipo.slice(0, 12).map(e => (
                    <tr key={e.maquina_id}>
                      <td>
                        <b>{e.nombre}</b>
                        <div className="an-mini"><i style={{ width: `${(e.minutos / maxEquipo) * 100}%` }} /></div>
                      </td>
                      <td className="an-dim">{e.area}</td>
                      <td>{e.paradas}</td>
                      <td>{fmt(e.minutos)}</td>
                      <td className="an-dim">{e.ultima ? fechaHora(e.ultima) : '—'}</td>
                      <td>
                        <button className="an-link"
                                onClick={() => setEquipo({ id: e.maquina_id, nombre: e.nombre })}>
                          historial
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="an-card">
              <span>Por línea</span>
              <table className="an-tabla compacta">
                <thead><tr><th>Línea</th><th>Paradas</th><th>Tiempo</th></tr></thead>
                <tbody>
                  {data.porLinea.map(l => (
                    <tr key={String(l.linea_id)}>
                      <td>{l.nombre}</td><td>{l.paradas}</td><td>{fmt(l.minutos)}</td>
                    </tr>
                  ))}
                  {!data.porLinea.length && <tr><td colSpan="3" className="an-dim">sin datos</td></tr>}
                </tbody>
              </table>

              <span className="an-sub">Por turno</span>
              <table className="an-tabla compacta">
                <thead><tr><th>Turno</th><th>Paradas</th><th>Tiempo</th></tr></thead>
                <tbody>
                  {data.porTurno.map(t => (
                    <tr key={t.turno}><td>{t.turno}</td><td>{t.paradas}</td><td>{fmt(t.minutos)}</td></tr>
                  ))}
                  {!data.porTurno.length && <tr><td colSpan="3" className="an-dim">sin datos</td></tr>}
                </tbody>
              </table>
            </section>

            <section className="an-card an-dias">
              <span>Tendencia por día</span>
              {dias.length === 0 && <p className="an-vacio">Sin paradas en el rango.</p>}
              {dias.length > 0 && (
                <div className="an-serie">
                  {dias.map(d => (
                    <div className="an-dia" key={d.dia} title={`${d.dia}: ${fmt(d.minutos)} · ${d.paradas} paradas`}>
                      <div className="an-dia-barra">
                        <i style={{ height: `${Math.max(4, (d.minutos / maxDia) * 100)}%` }} />
                      </div>
                      <small>{d.dia.slice(8, 10)}/{d.dia.slice(5, 7)}</small>
                      <em>{d.minutos}</em>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="an-card">
            <div className="an-hist-h">
              <span>{equipo ? `Historial de ${equipo.nombre}` : 'Historial de paradas'}</span>
              <small>{data.historial.length} registro{data.historial.length === 1 ? '' : 's'}</small>
              {equipo && <button className="an-link" onClick={() => setEquipo(null)}>ver todos</button>}
            </div>
            <table className="an-tabla an-hist">
              <thead>
                <tr>
                  <th>Inicio</th><th>Fin</th><th>Equipo</th><th>Línea</th>
                  <th>Causa</th><th>Min</th><th>Reparación / cambio</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.historial.map(p => (
                  <tr key={p.id}>
                    <td>{fechaHora(p.hora_inicio)}</td>
                    <td>{p.hora_fin ? hhmm(p.hora_fin) : <b className="an-abierta">abierta</b>}</td>
                    <td>
                      <button className="an-link" onClick={() => setEquipo({ id: p.maquina_id, nombre: p.maquina })}>
                        {p.maquina}
                      </button>
                    </td>
                    <td className="an-dim">{p.linea || '—'}</td>
                    <td>
                      {p.causa}
                      {p.es_planificada && <em className="an-tag">planificada</em>}
                    </td>
                    <td>{p.minutos}</td>
                    <td>
                      {(p.acciones || []).length === 0
                        ? <span className="an-dim">—</span>
                        : (p.acciones || []).map(a => (
                          <div key={a.id} className={`an-accion ${a.tipo}`}>
                            <b>{TIPOS.find(t => t.id === a.tipo)?.texto || a.tipo}</b>
                            {a.detalle && <span>{a.detalle}</span>}
                            {a.responsable && <small>{a.responsable}</small>}
                          </div>
                        ))}
                    </td>
                    <td>
                      <button className="an-btn" onClick={() => { setAnotando(p); setForm({ tipo: 'reparacion', detalle: '', responsable: '' }); }}>
                        ＋ anotar
                      </button>
                    </td>
                  </tr>
                ))}
                {!data.historial.length && (
                  <tr><td colSpan="8" className="an-dim">Sin paradas en el rango elegido.</td></tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}

      {anotando && (
        <div className="confirma-capa" onClick={() => setAnotando(null)}>
          <div className="confirma" onClick={e => e.stopPropagation()}>
            <h3>Anotar en la parada</h3>
            <p>{anotando.maquina} · {anotando.causa} · {fechaHora(anotando.hora_inicio)}</p>
            <label className="an-campo">Qué se hizo
              <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                {TIPOS.map(t => <option key={t.id} value={t.id}>{t.texto}</option>)}
              </select>
            </label>
            <label className="an-campo">Detalle
              <input value={form.detalle} autoFocus placeholder="Ej: se cambió la cinta y se ajustó el tensor"
                     onChange={e => setForm({ ...form, detalle: e.target.value })} />
            </label>
            <label className="an-campo">Responsable
              <input value={form.responsable} placeholder="Quién lo hizo"
                     onChange={e => setForm({ ...form, responsable: e.target.value })} />
            </label>
            <div className="confirma-acciones">
              <button className="ghost" onClick={() => setAnotando(null)}>Cancelar</button>
              <button className="btn-go small" onClick={guardarAccion}
                      disabled={!form.detalle.trim() || guardando}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
