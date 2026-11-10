import { useEffect, useMemo, useState } from 'react';
import {
  db, guardarCatalogo, leerCatalogo, guardarTablero, leerTablero,
  encolar, deshacer
} from './db';
import { api } from './api';
import { arrancarSync } from './sync';
import Settings from './Settings';

const nf = new Intl.NumberFormat('es-CL');

const ICONOS = {
  engranaje: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  rayo: 'M13 2 4.1 12.8a.7.7 0 0 0 .5 1.2H10l-1 8 8.9-10.8a.7.7 0 0 0-.5-1.2H13Z',
  gota: 'M12 2.5 6.6 9.2a7 7 0 1 0 10.8 0L12 2.5Z',
  herramienta: 'M20.7 3.3a5.5 5.5 0 0 1-6.7 7.1L4.6 19.8a2.2 2.2 0 0 1-3.1-3.1l9.4-9.4a5.5 5.5 0 0 1 7.1-6.7l-3 3 2.3 2.3 3-3Z',
  camion: 'M2 7h11v9H2z M13 10h4l4 4v2h-8z M6 18.2a1.7 1.7 0 1 0 0 .1Z M17.5 18.2a1.7 1.7 0 1 0 0 .1Z'
};

function minutos(desde, ahora) {
  if (!desde) return '';
  const min = Math.max(0, Math.floor((ahora - new Date(desde).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

export default function App() {
  const [cat, setCat] = useState(null);
  const [maqs, setMaqs] = useState([]);
  const [lineas, setLineas] = useState([]);
  const [trama, setTrama] = useState([]);
  const [sel, setSel] = useState('todas');

  const [locales, setLocales] = useState({});   // maquina_id -> parada local
  const [cerradas, setCerradas] = useState([]); // uuids cerrados en esta sesión

  const [ajustes, setAjustes] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [editor, setEditor] = useState(null);
  const [toast, setToast] = useState(null);
  const [pend, setPend] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [sinRed, setSinRed] = useState(false);
  const [ahora, setAhora] = useState(Date.now());
  const [error, setError] = useState(null);

  // ---- arranque: caché local primero, red después ----
  useEffect(() => {
    let vivo = true;
    (async () => {
      const cache = await leerTablero();
      if (cache && vivo) {
        setMaqs(cache.maquinas || []);
        setLineas(cache.lineas || []);
        setTrama(cache.trama || []);
      }
      const c = await leerCatalogo();
      if (c && vivo) setCat(c);

      try {
        const [catFresca, tab, lin] = await Promise.all([api.catalogo(), api.tablero(), api.lineas()]);
        if (!vivo) return;
        setCat(catFresca);
        setMaqs(tab.maquinas);
        setLineas(lin.lineas);
        setTrama(lin.trama);
        setSinRed(false);
        setError(null);
        await guardarCatalogo(catFresca);
        await guardarTablero({ maquinas: tab.maquinas, lineas: lin.lineas, trama: lin.trama });
      } catch (e) {
        console.warn('sin red', e.message);
        if (vivo) setSinRed(true);
      }
      setPend(await db.outbox.count());
    })();
    return () => { vivo = false; };
  }, []);

  // ---- red, reloj y sincronización ----
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const reloj = setInterval(() => setAhora(Date.now()), 15000);
    const detener = arrancarSync((p, hayRed) => {
      setPend(p);
      setSinRed(!hayRed);
    });
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      clearInterval(reloj);
      detener();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  async function refrescar() {
    try {
      const [tab, lin] = await Promise.all([api.tablero(), api.lineas()]);
      setMaqs(tab.maquinas);
      setLineas(lin.lineas);
      setTrama(lin.trama);
      await guardarTablero({ maquinas: tab.maquinas, lineas: lin.lineas, trama: lin.trama });
    } catch { /* sin red: se mantiene lo que hay */ }
  }

  // ---- estado efectivo de cada máquina ----
  function estadoDe(m) {
    const loc = locales[m.id];
    if (loc) {
      const propia = !loc.origen_id || loc.origen_id === m.id;
      return propia
        ? { tipo: loc.es_planificada ? 'plan' : 'stop', propia: true, p: loc }
        : {
            tipo: 'cascada',
            propia: false,
            p: {
              ...loc,
              origen: (maqs.find(x => x.id === loc.origen_id) || {}).nombre_corto || 'otra máquina'
            }
          };
    }
    if (m.uuid_cliente && !cerradas.includes(m.uuid_cliente)) {
      return {
        tipo: m.es_planificada ? 'plan' : 'stop',
        propia: true,
        p: { uuid: m.uuid_cliente, causa: m.causa, hora_inicio: m.hora_inicio, alcance: m.alcance, es_planificada: m.es_planificada }
      };
    }
    if (m.af_uuid && !cerradas.includes(m.af_uuid)) {
      return {
        tipo: 'cascada',
        propia: false,
        p: { uuid: m.af_uuid, causa: m.af_causa, hora_inicio: m.af_inicio, alcance: m.af_alcance, origen: m.af_origen }
      };
    }
    return { tipo: 'run' };
  }

  const totalDetenidas = maqs.filter(m => estadoDe(m).tipo !== 'run').length;

  // Estado de una línea según lo que ve el operador (incluye paradas locales
  // todavía sin sincronizar).
  function estadoLinea(l) {
    const enLinea = trama
      .filter(t => t.linea_id === l.linea_id)
      .map(t => maqs.find(m => m.id === t.maquina_id))
      .filter(Boolean);

    const activas = enLinea
      .map(m => ({ m, e: estadoDe(m) }))
      .filter(x => x.e.tipo !== 'run');

    if (!activas.length) return { estado: 'operando' };

    const origen = activas.find(x => x.e.propia) || activas[0];
    const total = activas.some(x => x.e.p.alcance === 'linea');
    return {
      estado: total ? 'detenida' : 'parcial',
      causa: origen.e.p.causa,
      origen: origen.m.nombre_corto,
      desde: origen.e.p.hora_inicio
    };
  }

  const areas = useMemo(() => {
    if (!cat) return [];
    return cat.areas.map(a => ({
      ...a,
      maquinas: maqs.filter(m => m.area_id === a.id)
    }));
  }, [cat, maqs]);

  const lineaActual = sel === 'todas' ? null : lineas.find(l => l.linea_id === sel);

  const maquinasLinea = useMemo(() => {
    if (!lineaActual) return [];
    return trama
      .filter(t => t.linea_id === lineaActual.linea_id)
      .sort((a, b) => a.posicion - b.posicion)
      .map(t => {
        const m = maqs.find(x => x.id === t.maquina_id);
        return m ? { ...m, posicion: t.posicion } : null;
      })
      .filter(Boolean);
  }, [lineaActual, trama, maqs]);

  // ---- acciones ----
  function tocar(m, est) {
    if (!cat) return;
    setError(null);
    if (est.tipo === 'run') setSheet({ tipo: 'categorias', maquina: m });
    else setSheet({ tipo: 'reanudar', maquina: m, parada: est.p, propia: est.propia });
  }

  async function registrar(maq, causa, categoria) {
    const uuid = crypto.randomUUID();
    const inicio = new Date().toISOString();
    const alcance = maq.detiene_linea ? 'linea' : (maq.linea_id ? 'aguas_abajo' : 'maquina');
    const parada = {
      uuid, causa: causa.descripcion, hora_inicio: inicio, alcance,
      es_planificada: causa.es_planificada, origen_id: maq.id
    };

    // pintado inmediato: la máquina y las que la línea arrastra
    setLocales(prev => aplicarLocal(prev, maq, parada));
    try {
      const evId = await encolar({
        tipo: 'abrir', uuid, maquina_id: maq.id, causa_id: causa.id,
        hora_inicio: inicio, impacto: 'Total'
      });
      setPend(await db.outbox.count());
      setSheet(null);
      setToast({
        titulo: 'Parada registrada',
        detalle: `${maq.nombre_corto} · ${causa.descripcion}` +
          (alcance === 'linea' ? ' · detiene la línea' : alcance === 'aguas_abajo' ? ' · detiene aguas abajo' : ''),
        eventoId: evId, uuid, tipo: 'abrir', volver: { maqId: maq.id, alcance, linea: maq.linea_id, posicion: maq.posicion }
      });
    } catch (e) {
      setError('No se pudo guardar el registro: ' + e.message);
    }
  }

  function aplicarLocal(prev, maq, parada) {
    const next = { ...prev, [maq.id]: parada };
    if (maq.linea_id && parada.alcance !== 'maquina') {
      const enLinea = trama.filter(t => t.linea_id === maq.linea_id);
      for (const t of enLinea) {
        if (t.maquina_id === maq.id) continue;
        const afectada = parada.alcance === 'linea' || t.posicion >= (maq.posicion ?? 0);
        if (afectada && !next[t.maquina_id]) {
          next[t.maquina_id] = { ...parada, origen_id: maq.id };
        }
      }
    }
    return next;
  }

  async function reanudar(maq, parada, comentario) {
    const fin = new Date().toISOString();
    const dur = minutos(parada.hora_inicio, Date.now());

    // la parada y todas las máquinas que arrastraba vuelven a operar
    setLocales(prev => Object.fromEntries(Object.entries(prev).filter(([, v]) => v.uuid !== parada.uuid)));
    setCerradas(prev => [...prev, parada.uuid]);

    const evId = await encolar({
      tipo: 'cerrar', uuid: parada.uuid, hora_fin: fin, comentario: comentario || null
    });
    setPend(await db.outbox.count());
    setSheet(null);
    setToast({
      titulo: 'Operación reanudada',
      detalle: `${maq.nombre_corto} · ${dur} de parada`,
      eventoId: evId, uuid: parada.uuid, tipo: 'cerrar'
    });
  }

  async function deshacerAccion() {
    if (!toast) return;
    await deshacer(toast.eventoId);
    if (toast.tipo === 'abrir') {
      setLocales(prev => Object.fromEntries(Object.entries(prev).filter(([, v]) => v.uuid !== toast.uuid)));
    } else {
      // se quitó el cierre: la parada vuelve a estar en curso
      setCerradas(prev => prev.filter(u => u !== toast.uuid));
    }
    setPend(await db.outbox.count());
    setToast(null);
  }

  // ---- editor de trama ----
  function abrirEditor(lineaParam) {
    const linea = lineaParam || lineaActual;
    if (!linea) return;
    const lineaId = linea.linea_id ?? linea.id;
    const filas = trama
      .filter(t => t.linea_id === lineaId)
      .sort((a, b) => a.posicion - b.posicion)
      .map(t => ({
        maquina_id: t.maquina_id, nombre_corto: t.nombre_corto,
        area: t.area, detiene_linea: t.detiene_linea
      }));
    setEditor({ linea: { ...linea, linea_id: lineaId }, filas, nueva: '', error: null, guardando: false });
  }

  function editar(fn) {
    setEditor(prev => {
      const e = { ...prev, filas: fn(prev.filas) };
      return e;
    });
  }

  const mover = (i, dir) => editar(filas => {
    const j = i + dir;
    if (j < 0 || j >= filas.length) return filas;
    const copia = [...filas];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    return copia;
  });

  const quitar = (i) => editar(filas => filas.filter((_, k) => k !== i));

  const marcarCuello = (i) => editar(filas => filas.map((f, k) => ({ ...f, detiene_linea: k === i })));

  function agregarMaquina() {
    const id = Number(editor.nueva);
    if (!id) return;
    const m = maqs.find(x => x.id === id);
    if (!m) return;
    editar(filas => [...filas, {
      maquina_id: m.id, nombre_corto: m.nombre_corto, area: m.area, detiene_linea: false
    }]);
    setEditor(prev => ({ ...prev, nueva: '' }));
  }

  async function guardarTrama() {
    setEditor(prev => ({ ...prev, guardando: true, error: null }));
    try {
      await api.guardarTrama(editor.linea.linea_id, editor.filas.map(f => ({
        maquina_id: f.maquina_id, detiene_linea: f.detiene_linea
      })));
      const [tab, lin] = await Promise.all([api.tablero(), api.lineas()]);
      setMaqs(tab.maquinas);
      setLineas(lin.lineas);
      setTrama(lin.trama);
      await guardarTablero({ maquinas: tab.maquinas, lineas: lin.lineas, trama: lin.trama });
      setEditor(null);
      setToast({ titulo: 'Trama guardada', detalle: `${editor.linea.nombre} · ${editor.filas.length} máquinas` });
    } catch (e) {
      setEditor(prev => ({ ...prev, guardando: false, error: e.message }));
    }
  }

  const disponibles = useMemo(() => {
    if (!editor) return [];
    const usadas = new Set(editor.filas.map(f => f.maquina_id));
    return maqs.filter(m => !usadas.has(m.id));
  }, [editor, maqs]);

  // ---- render ----
  function Tile({ m, conPosicion }) {
    const est = estadoDe(m);
    const texto = est.tipo === 'run'
      ? '▶ Operando'
      : est.tipo === 'cascada'
        ? `↯ Detenida por ${est.p.origen}`
        : `■ ${est.p.causa} · ${minutos(est.p.hora_inicio, ahora)}`;
    return (
      <button className={`tile ${est.tipo}`} onClick={() => tocar(m, est)}>
        <span className="code">{conPosicion && m.posicion ? `${m.posicion} · ` : ''}{m.codigo}</span>
        <span className="name">{m.nombre_corto}</span>
        <span className="state">{est.tipo === 'plan' ? `◷ ${est.p.causa}` : texto}</span>
        {est.tipo === 'stop' && <span className="pulse" />}
      </button>
    );
  }

  return (
    <div className="app">
      <header>
        <div className="brand">
          <div className="mark" />
          <div>
            <b>Tablero de Planta</b>
            <span>{cat?.turno ? `${cat.turno.nombre} · ${cat.turno.supervisor}` : 'Sin turno activo'}</span>
          </div>
        </div>

        <div className="hint"><kbd>1</kbd> máquina <b>·</b> <kbd>2</kbd> causa</div>

        <div className={`net ${online && !sinRed ? '' : 'off'}`}>
          <i /> <span>{online && !sinRed ? 'En línea' : 'Sin enlace'}</span>
          <span className="dim">|</span>
          <span>{pend === 0 ? 'sin pendientes' : `${pend} ${pend === 1 ? 'pendiente' : 'pendientes'}`}</span>
        </div>

        <button className="gear" onClick={() => setAjustes(true)} title="Ajustes de planta" aria-label="Ajustes">
          <svg viewBox="0 0 24 24">{ICONOS.engranaje && <path d={ICONOS.engranaje} />}</svg>
        </button>

        <div className="clock">
          <b>{new Date(ahora).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</b>
          <span>{new Date(ahora).toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' })}</span>
        </div>
      </header>

      {sinRed && (
        <div className="aviso off">Sin conexión · los registros quedan en la tablet y se envían al volver la red</div>
      )}
      {error && <div className="aviso error">{error}</div>}

      <div className="layout">
        <aside className="side">
          <div className="side-h">Líneas de planta</div>
          <button className={`line-item ${sel === 'todas' ? 'on' : ''}`} onClick={() => setSel('todas')}>
            <span className="line-badge">
              <svg viewBox="0 0 24 24">
                <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
                <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
                <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
                <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
              </svg>
            </span>
            <span className="lname">
              <b>Todas las máquinas</b>
              <small>{maqs.length} en planta</small>
            </span>
            <span className={`pill ${totalDetenidas ? 'detenida' : ''}`}>
              {totalDetenidas ? `${totalDetenidas} parada${totalDetenidas === 1 ? '' : 's'}` : 'OK'}
            </span>
          </button>

          {lineas.map(l => {
            const st = estadoLinea(l);
            return (
              <button key={l.linea_id} className={`line-item ${sel === l.linea_id ? 'on' : ''}`}
                      onClick={() => setSel(l.linea_id)}>
                <span className="line-badge">{l.codigo}</span>
                <span className="lname">
                  <b>{l.nombre}</b>
                  <small>
                    {l.maquinas} máquinas
                    {st.estado === 'operando' ? ' · operando' : ` · ${st.causa}`}
                  </small>
                </span>
                <span className={`pill ${st.estado}`}>
                  {st.estado === 'operando' ? 'OK' : st.estado === 'detenida' ? 'PARADA' : 'PARCIAL'}
                </span>
              </button>
            );
          })}

          {lineaActual && (
            <button className="btn-edit" onClick={abrirEditor}>
              <svg viewBox="0 0 24 24">
                <path d="M4 20h4.5L19 9.5 14.5 5 4 15.5V20Z" />
                <path d="m13.5 6 4.5 4.5" />
              </svg>
              Editar trama
            </button>
          )}

          <div className="side-foot">
            <span>{totalDetenidas} máquinas detenidas</span>
            <span>{nf.format(maqs.length)} en planta</span>
          </div>
        </aside>

        <main className="stage">
          {!cat && <div className="aviso">Cargando catálogo de planta…</div>}

          {lineaActual ? (
            <>
              <div className={`line-head ${estadoLinea(lineaActual).estado}`}>
                <b>{lineaActual.nombre}</b>
                <span>
                  {estadoLinea(lineaActual).estado === 'operando'
                    ? 'Línea operando'
                    : `${estadoLinea(lineaActual).estado === 'detenida' ? 'Parada total' : 'Parada parcial'} · ${estadoLinea(lineaActual).causa} · desde ${estadoLinea(lineaActual).origen}`}
                </span>
              </div>
              <div className="flow">
                {maquinasLinea.map((m, i) => (
                  <div className="flow-cell" key={m.id}>
                    {i > 0 && <span className="arrow">→</span>}
                    <Tile m={m} conPosicion />
                  </div>
                ))}
              </div>
              <p className="flow-hint">
                El orden es el flujo real: si se detiene una máquina marcada como cuello, la línea completa se detiene;
                si no, se detiene lo que viene aguas abajo.
              </p>
            </>
          ) : maqs.length === 0 ? (
            <div className="empty">
              <div className="empty-mark">◫</div>
              <h2>La planta está vacía</h2>
              <p>Armá la primera línea con sus equipos y su receta. Toma tres pasos y queda lista para operar.</p>
              <button className="btn-go small" onClick={() => setAjustes(true)}>＋ Armar línea</button>
            </div>
          ) : (
            <div className="board">
              {areas.map(a => (
                <section className="area" key={a.id}>
                  <h2>{a.nombre} <em>{a.maquinas.length}</em></h2>
                  {a.maquinas.map(m => <Tile key={m.id} m={m} />)}
                </section>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* ---- paneles ---- */}
      {sheet?.tipo === 'categorias' && (
        <div className="sheet">
          <div className="top">
            <div>
              <h3>{sheet.maquina.nombre}</h3>
              <div className="sub">
                {sheet.maquina.codigo} · ¿qué la detuvo?
                {sheet.maquina.detiene_linea ? ' · esta máquina detiene la línea' : ''}
              </div>
            </div>
            <button className="x" onClick={() => setSheet(null)}>✕</button>
          </div>
          <div className="cats">
            {cat.categorias.map(c => {
              const n = cat.causas.filter(x => x.categoria_id === c.id).length;
              return (
                <button key={c.id} className="cat" onClick={() => setSheet({ ...sheet, tipo: 'causas', categoria: c })}>
                  <svg viewBox="0 0 24 24">{ICONOS[c.icono] && <path d={ICONOS[c.icono]} />}</svg>
                  <span className="catname">{c.nombre}</span>
                  <small>{n} causas</small>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {sheet?.tipo === 'causas' && (
        <div className="sheet">
          <div className="top">
            <button className="x back" onClick={() => setSheet({ tipo: 'categorias', maquina: sheet.maquina })}>←</button>
            <div>
              <h3>{sheet.categoria.nombre}</h3>
              <div className="sub">{sheet.maquina.nombre} · elige la causa</div>
            </div>
            <button className="x" onClick={() => setSheet(null)}>✕</button>
          </div>
          <div className="causes">
            {cat.causas.filter(c => c.categoria_id === sheet.categoria.id).map((c, i) => (
              <button key={c.id} className={`cause ${c.es_planificada ? 'plan' : ''}`}
                      onClick={() => registrar(sheet.maquina, c, sheet.categoria)}>
                <span className="idx">{String(i + 1).padStart(2, '0')}</span>
                {c.descripcion}
                {c.es_planificada && <em>planificada</em>}
              </button>
            ))}
          </div>
        </div>
      )}

      {sheet?.tipo === 'reanudar' && (
        <div className="sheet">
          <div className="top">
            <div>
              <h3>{sheet.maquina.nombre}</h3>
              <div className="sub">
                {sheet.propia
                  ? `Parada en curso · ${sheet.parada.causa}`
                  : `Detenida por ${sheet.parada.origen} · ${sheet.parada.causa}`}
                {sheet.parada.alcance === 'linea' ? ' · afecta la línea completa' : ''}
              </div>
            </div>
            <button className="x" onClick={() => setSheet(null)}>✕</button>
          </div>
          <div className="resume">
            <div className="timer">{minutos(sheet.parada.hora_inicio, ahora)}</div>
            <button className="btn-go" onClick={() => {
              const txt = document.getElementById('comment')?.value || '';
              reanudar(sheet.maquina, sheet.parada, txt);
            }}>▶ Reanudar operación</button>
            <textarea id="comment" className="comment" placeholder="Comentario (opcional)" />
          </div>
        </div>
      )}

      {editor && (
        <div className="sheet">
          <div className="top">
            <div>
              <h3>Trama · {editor.linea.nombre}</h3>
              <div className="sub">
                El orden es el flujo de la línea. Solo un cuello de botella, y ese detiene la línea completa.
              </div>
            </div>
            <button className="x" onClick={() => setEditor(null)}>✕</button>
          </div>

          <div className="trama">
            {editor.filas.map((f, i) => (
              <div className="trama-row" key={f.maquina_id}>
                <span className="pos">{i + 1}</span>
                <b>{f.nombre_corto}</b>
                <span className="area">{f.area}</span>
                <label className={`cuello ${f.detiene_linea ? 'on' : ''}`}>
                  <input type="radio" name="cuello" checked={f.detiene_linea} onChange={() => marcarCuello(i)} />
                  cuello de línea
                </label>
                <div className="acciones">
                  <button onClick={() => mover(i, -1)} disabled={i === 0}>↑</button>
                  <button onClick={() => mover(i, 1)} disabled={i === editor.filas.length - 1}>↓</button>
                  <button onClick={() => quitar(i)} disabled={editor.filas.length === 1}>✕</button>
                </div>
              </div>
            ))}
          </div>

          <div className="add-row">
            <select value={editor.nueva} onChange={e => setEditor(prev => ({ ...prev, nueva: e.target.value }))}>
              <option value="">Agregar máquina…</option>
              {disponibles.map(m => (
                <option key={m.id} value={m.id}>{m.nombre_corto} · {m.area}</option>
              ))}
            </select>
            <button onClick={agregarMaquina} disabled={!editor.nueva}>Agregar</button>
          </div>

          <div className="editor-foot">
            <span className="err">{editor.error || ''}</span>
            <button className="ghost" onClick={() => setEditor(null)}>Cancelar</button>
            <button className="btn-go small" onClick={guardarTrama} disabled={editor.guardando}>
              {editor.guardando ? 'Guardando…' : 'Guardar trama'}
            </button>
          </div>
        </div>
      )}

      {ajustes && (
        <Settings
          onClose={() => { setAjustes(false); refrescar(); }}
          onSaved={refrescar}
          onTrama={(linea) => {
            setSel(linea.id);
            setAjustes(false);
            refrescar().then(() => abrirEditor(linea));
          }}
        />
      )}

      {toast && (
        <div className="toast">
          <div>
            <b>{toast.titulo}</b>
            <small>{toast.detalle}</small>
          </div>
          {toast.eventoId && <button onClick={deshacerAccion}>Deshacer</button>}
        </div>
      )}
    </div>
  );
}
