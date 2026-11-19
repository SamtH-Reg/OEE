import { useEffect, useMemo, useState } from 'react';
import { api } from './api';

const hhmm = (iso) => new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
const fechaDia = (v) => {
  if (!v) return '';
  const d = /T/.test(String(v)) ? new Date(v) : new Date(`${v}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
};
const aInput = (iso) => {
  const d = new Date(iso);
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
};
const fmtMin = (m) => {
  const min = Math.max(0, Math.round(m || 0));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
};

export default function LineaParadas({ lineaId, causas = [], maquinas = [], onCambio }) {
  const [paradas, setParadas] = useState([]);
  const [proceso, setProceso] = useState(null);
  const [turnos, setTurnos] = useState([]);
  const [turno, setTurno] = useState(null);
  const [edit, setEdit] = useState(null);
  const [nueva, setNueva] = useState(null);   // alta manual de una parada que ya pasó
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function cargarTurnos() {
    try {
      const r = await api.turnosLinea(lineaId);
      setTurnos(r.turnos || []);
      setTurno(t => t ?? r.actual ?? r.turnos?.[0]?.id ?? null);
    } catch { /* sin red */ }
  }

  async function cargar(idTurno) {
    setCargando(true);
    try {
      const r = await api.paradasLinea(lineaId, idTurno);
      setParadas(r.paradas || []);
      setProceso(r.proceso || null);
    } catch { /* sin red */ }
    setCargando(false);
  }

  useEffect(() => {
    setTurno(null); setParadas([]); setTurnos([]); setProceso(null);
    cargarTurnos();
    /* eslint-disable-next-line */
  }, [lineaId]);

  useEffect(() => { if (turno) cargar(turno); /* eslint-disable-next-line */ }, [turno]);

  const totalParado = paradas.reduce((s, p) => s + (p.minutos || 0), 0);

  // ventana de la línea de tiempo: el proceso; si no hay datos, el rango de las paradas
  const ventana = useMemo(() => {
    const ini = paradas.map(p => new Date(p.hora_inicio).getTime());
    const fin = paradas.map(p => (p.hora_fin ? new Date(p.hora_fin).getTime() : Date.now()));
    let desde = proceso?.desde ? new Date(proceso.desde).getTime() : (ini.length ? Math.min(...ini) : Date.now());
    let hasta = proceso?.hasta ? new Date(proceso.hasta).getTime() : Date.now();
    if (ini.length) desde = Math.min(desde, Math.min(...ini));
    if (fin.length) hasta = Math.max(hasta, Math.max(...fin));
    if (!(hasta > desde)) hasta = desde + 60 * 60 * 1000;
    return { desde, hasta, ancho: hasta - desde };
  }, [paradas, proceso]);

  // marcas de hora: arranque, cada 15/30/60 minutos según el largo, y el final
  const marcas = useMemo(() => {
    const horas = ventana.ancho / 3600000;
    const pasoMin = horas <= 1.5 ? 15 : horas <= 3 ? 30 : horas <= 6 ? 60 : horas <= 12 ? 120 : 240;
    const out = [];
    const poner = (t) => {
      const izq = ((t - ventana.desde) / ventana.ancho) * 100;
      out.push({ t, izq, txt: new Date(t).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) });
    };
    poner(ventana.desde);
    const paso = pasoMin * 60000;
    let t = Math.ceil((ventana.desde + 1) / paso) * paso;
    for (; t < ventana.hasta - paso * 0.4; t += paso) poner(t);
    if ((ventana.hasta - out[out.length - 1].t) / 60000 > pasoMin * 0.4) poner(ventana.hasta);
    return out;
  }, [ventana]);

  const porMaquina = useMemo(() => {
    const mapa = new Map();
    for (const p of paradas) {
      if (!mapa.has(p.maquina_id)) mapa.set(p.maquina_id, { maquina: p.maquina, paradas: [] });
      mapa.get(p.maquina_id).paradas.push(p);
    }
    return [...mapa.values()].sort((a, b) => a.maquina.localeCompare(b.maquina));
  }, [paradas]);

  const minutosProceso = Math.max(0, (ventana.ancho - totalParado * 60000) / 60000);

  function abrirEdicion(p) {
    setError(null);
    setEdit({
      id: p.id, maquina: p.maquina, causa: p.codigo_causa_id || '',
      comentario: p.comentarios_operador || '',
      desde: aInput(p.hora_inicio), hasta: p.hora_fin ? aInput(p.hora_fin) : '',
      hora_inicio: p.hora_inicio, hora_fin: p.hora_fin
    });
  }

  async function guardar() {
    try {
      const orig = paradas.find(x => x.id === edit.id) || {};
      await api.editarParada(edit.id, {
        hora_inicio: edit.desde !== aInput(orig.hora_inicio) ? new Date(edit.desde).toISOString() : orig.hora_inicio,
        hora_fin: !edit.hasta
          ? null
          : (edit.hasta !== aInput(orig.hora_fin) ? new Date(edit.hasta).toISOString() : orig.hora_fin),
        codigo_causa_id: edit.causa ? Number(edit.causa) : null,
        comentario: edit.comentario
      });
      setEdit(null); setError(null);
      await cargar(turno); cargarTurnos(); onCambio && onCambio();
    } catch (e) { setError(e.message); }
  }

  function abrirNueva() {
    const ahora = new Date();
    const desde = new Date(ahora.getTime() - 15 * 60000);
    setError(null);
    setNueva({
      maquina_id: maquinas[0]?.maquina_id || maquinas[0]?.id || '',
      codigo_causa_id: causas[0]?.id || '', desde: aInput(desde), hasta: aInput(ahora), comentario: ''
    });
  }

  async function crear() {
    try {
      await api.crearParada({
        maquina_id: Number(nueva.maquina_id),
        codigo_causa_id: nueva.codigo_causa_id ? Number(nueva.codigo_causa_id) : null,
        hora_inicio: new Date(nueva.desde).toISOString(),
        hora_fin: nueva.hasta ? new Date(nueva.hasta).toISOString() : null,
        linea_id: lineaId,
        turno_id: turno,
        comentario: nueva.comentario
      });
      setNueva(null); setError(null);
      await cargar(turno); cargarTurnos(); onCambio && onCambio();
    } catch (e) { setError(e.message); }
  }

  async function anular(p) {
    try {
      await api.anularParada(p.id, 'cargada por error');
      await cargar(turno); cargarTurnos(); onCambio && onCambio();
    } catch (e) { setError(e.message); }
  }

  const elegido = turnos.find(t => t.id === turno) || null;

  return (
    <section className="lp">
      <div className="lp-head">
        <b>Proceso de la línea</b>
        <select className="lp-turno" value={turno ?? ''} onChange={e => setTurno(Number(e.target.value))}
                title="Turno y fecha">
          {turnos.map(t => (
            <option key={t.id} value={t.id}>
              {fechaDia(t.fecha)} · {t.paradas} {t.paradas === 1 ? 'parada' : 'paradas'} · {fmtMin(t.minutos)}
            </option>
          ))}
          {!turnos.length && <option value="">sin turnos</option>}
        </select>
        <span className="lp-dato">
          {hhmm(ventana.desde)}–{proceso?.hasta ? hhmm(ventana.hasta) : 'ahora'} ·
          {' '}{fmtMin(minutosProceso)} de proceso · <b className="lp-rojo">{fmtMin(totalParado)}</b> detenido
        </span>
        <button className="lp-add" onClick={abrirNueva} title="Agregar una parada que ya pasó">＋ Agregar parada</button>
        <button className="lp-ref" onClick={() => { cargarTurnos(); cargar(turno); }}
                title="Actualizar" disabled={cargando}>⟳</button>
      </div>

      <div className="lp-gantt">
        <div className="lp-eje">
          <span className="lp-eje-nombre" />
          <div className="lp-eje-track">
            {marcas.map(m => (
              <span key={m.t} className="lp-marca" style={{ left: `${m.izq}%` }}>{m.txt}</span>
            ))}
          </div>
        </div>

        <div className="lp-fila">
          <span className="lp-nombre">Línea</span>
          <div className="lp-track">
            <div className="lp-base" style={{ left: 0, width: '100%' }} />
            {paradas.map(p => {
              const ini = new Date(p.hora_inicio).getTime();
              const fin = p.hora_fin ? new Date(p.hora_fin).getTime() : Date.now();
              return (
                <button key={p.id} className="lp-bloque" onClick={() => abrirEdicion(p)}
                  style={{
                    left: `${((ini - ventana.desde) / ventana.ancho) * 100}%`,
                    width: `${Math.max(0.5, ((fin - ini) / ventana.ancho) * 100)}%`
                  }}
                  title={`${hhmm(p.hora_inicio)}–${p.hora_fin ? hhmm(p.hora_fin) : 'ahora'} · ${p.maquina} · ${p.causa || 'sin causa'} · ${fmtMin(p.minutos)}`} />
              );
            })}
          </div>
        </div>

        {porMaquina.map(m => (
          <div className="lp-fila" key={m.maquina}>
            <span className="lp-nombre" title={m.maquina}>{m.maquina}</span>
            <div className="lp-track">
              {m.paradas.map(p => {
                const ini = new Date(p.hora_inicio).getTime();
                const fin = p.hora_fin ? new Date(p.hora_fin).getTime() : Date.now();
                return (
                  <button key={p.id} className="lp-bloque" onClick={() => abrirEdicion(p)}
                    style={{
                      left: `${((ini - ventana.desde) / ventana.ancho) * 100}%`,
                      width: `${Math.max(0.5, ((fin - ini) / ventana.ancho) * 100)}%`
                    }}
                    title={`${hhmm(p.hora_inicio)}–${p.hora_fin ? hhmm(p.hora_fin) : 'ahora'} · ${p.causa || 'sin causa'} · ${fmtMin(p.minutos)}`} />
                );
              })}
            </div>
          </div>
        ))}

        {!paradas.length && (
          <p className="lp-vacio">
            Sin paradas en {elegido ? `el turno del ${fechaDia(elegido.fecha)}` : 'este turno'}: la línea estuvo en proceso todo el tiempo.
          </p>
        )}
      </div>

      {nueva && (
        <div className="confirma-capa" onClick={() => setNueva(null)}>
          <div className="confirma" onClick={e => e.stopPropagation()}>
            <h3>Agregar parada</h3>
            <p>Para lo que el operador avisa después: elegí el equipo y la hora en que estuvo parado.</p>
            <label className="an-campo">Equipo
              <select value={nueva.maquina_id} onChange={e => setNueva({ ...nueva, maquina_id: e.target.value })}>
                {maquinas.map(m => (
                  <option key={m.maquina_id || m.id} value={m.maquina_id || m.id}>{m.nombre_corto || m.nombre}</option>
                ))}
              </select>
            </label>
            <label className="an-campo">Causa
              <select value={nueva.codigo_causa_id} onChange={e => setNueva({ ...nueva, codigo_causa_id: e.target.value })}>
                {causas.map(c => <option key={c.id} value={c.id}>{c.descripcion}</option>)}
              </select>
            </label>
            <label className="an-campo">Desde
              <input type="datetime-local" value={nueva.desde}
                     onChange={e => setNueva({ ...nueva, desde: e.target.value })} />
            </label>
            <label className="an-campo">Hasta <em>(vacío = sigue parada)</em>
              <input type="datetime-local" value={nueva.hasta}
                     onChange={e => setNueva({ ...nueva, hasta: e.target.value })} />
            </label>
            <label className="an-campo">Comentario <em>(opcional)</em>
              <input value={nueva.comentario} onChange={e => setNueva({ ...nueva, comentario: e.target.value })} />
            </label>
            {error && <p className="err">{error}</p>}
            <div className="confirma-acciones">
              <button className="ghost" onClick={() => setNueva(null)}>Cancelar</button>
              <button className="btn-go small" onClick={crear}>Agregar</button>
            </div>
          </div>
        </div>
      )}

      {edit && (
        <div className="confirma-capa" onClick={() => setEdit(null)}>
          <div className="confirma" onClick={e => e.stopPropagation()}>
            <h3>Corregir la parada · {edit.maquina}</h3>
            <p>Cambiá la hora o la causa. Si la cargaste por error, anulala.</p>
            <label className="an-campo">Causa
              <select value={edit.causa} onChange={e => setEdit({ ...edit, causa: e.target.value })}>
                <option value="">Sin causa</option>
                {causas.map(c => <option key={c.id} value={c.id}>{c.descripcion}</option>)}
              </select>
            </label>
            <label className="an-campo">Desde
              <input type="datetime-local" value={edit.desde}
                     onChange={e => setEdit({ ...edit, desde: e.target.value })} />
            </label>
            <label className="an-campo">Hasta <em>(vacío = sigue parada)</em>
              <input type="datetime-local" value={edit.hasta}
                     onChange={e => setEdit({ ...edit, hasta: e.target.value })} />
            </label>
            {error && <p className="err">{error}</p>}
            <div className="confirma-acciones">
              <button className="ghost" onClick={() => setEdit(null)}>Cancelar</button>
              <button className="ghost peligro" onClick={async () => {
                const p = paradas.find(x => x.id === edit.id);
                if (p) await anular(p);
                setEdit(null);
              }}>Anular</button>
              <button className="btn-go small" onClick={guardar}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
