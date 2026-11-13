import { useEffect, useMemo, useRef, useState } from 'react';
import {
  db, guardarCatalogo, leerCatalogo, guardarTablero, leerTablero,
  encolar, deshacer
} from './db';
import { api } from './api';
import { arrancarSync } from './sync';
import Settings from './Settings';
import LineaRapida from './LineaRapida';
import Analisis from './Analisis';

const nf = new Intl.NumberFormat('es-CL');

// un color por bloque de origen, para seguir las conexiones de un vistazo
const PALETA = ['#2F80ED', '#27AE60', '#E58E26', '#9B51E0', '#EB5757',
                '#00A3A3', '#C77DFF', '#B8860B', '#4C6EF5', '#E64980'];

const ICONOS = {
  engranaje: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  rayo: 'M13 2 4.1 12.8a.7.7 0 0 0 .5 1.2H10l-1 8 8.9-10.8a.7.7 0 0 0-.5-1.2H13Z',
  gota: 'M12 2.5 6.6 9.2a7 7 0 1 0 10.8 0L12 2.5Z',
  herramienta: 'M20.7 3.3a5.5 5.5 0 0 1-6.7 7.1L4.6 19.8a2.2 2.2 0 0 1-3.1-3.1l9.4-9.4a5.5 5.5 0 0 1 7.1-6.7l-3 3 2.3 2.3 3-3Z',
  camion: 'M2 7h11v9H2z M13 10h4l4 4v2h-8z M6 18.2a1.7 1.7 0 1 0 0 .1Z M17.5 18.2a1.7 1.7 0 1 0 0 .1Z'
};

const sinTildes = (t) =>
  (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const hhmm = (iso) => new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

const fmtMin = (m) => {
  const min = Math.max(0, Math.round(m || 0));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
};

const minutos = (desde, ahora) => {
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
  const [conexiones, setConexiones] = useState([]);
  const [procesos, setProcesos] = useState([]);
  const [monitor, setMonitor] = useState(null);   // paradas del turno (sólo lectura)
  const [procesoId, setProcesoId] = useState(null);
  const [lineasSel, setLineasSel] = useState([]);      // líneas del proceso del turno
  const [lineasAbierto, setLineasAbierto] = useState(false);  // desplegable de líneas del turno
  const [sel, setSel] = useState('todas');

  const [locales, setLocales] = useState({});   // maquina_id -> parada local
  const [cerradas, setCerradas] = useState([]); // uuids cerrados en esta sesión

  const [ajustes, setAjustes] = useState(false);
  const [analisis, setAnalisis] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [editor, setEditor] = useState(null);
  const [seleccionada, setSeleccionada] = useState(null);  // tarjeta elegida en el editor
  const [lineaRapida, setLineaRapida] = useState(null);    // { equipos: [] } panel de línea nueva
  const [conflictoEquipos, setConflictoEquipos] = useState([]);  // equipos repetidos del último guardado
  const [confirmarActivacion, setConfirmarActivacion] = useState(null);  // aviso al sacar líneas del turno
  const [confirmarCierre, setConfirmarCierre] = useState(false);         // aviso de fin de turno
  const [picker, setPicker] = useState(false);             // panel interactivo para agregar
  const [pickerBuscar, setPickerBuscar] = useState('');
  const flowRef = useRef(null);
  const [links, setLinks] = useState([]);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [cable, setCable] = useState(null);         // conexión que se está dibujando
  const [moviendo, setMoviendo] = useState(null);   // tarjeta que se arrastra
  const [avisoEditor, setAvisoEditor] = useState(null);
  const [modoConexion, setModoConexion] = useState(null);   // origen esperando destino
  const [zoom, setZoom] = useState(1);
  const [arrastre, setArrastre] = useState(null);   // maquina_id que se está moviendo
  const [sobre, setSobre] = useState(null);         // destino bajo el cursor
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
        const [catFresca, tab, lin, proc] = await Promise.all([
          api.catalogo(), api.tablero(), api.lineas(), api.procesos()
        ]);
        if (!vivo) return;
        setCat(catFresca);
        setMaqs(tab.maquinas);
        setLineas(lin.lineas);
        setTrama(lin.trama);
        setConexiones(lin.conexiones || []);
        setProcesos(proc.procesos || []);
        const pid = catFresca.turno?.proceso_id ? Number(catFresca.turno.proceso_id) : null;
        setProcesoId(pid);
        let lista = proc.procesos || [];
        let psel = lista.find(x => x.id === pid);
        // Si el turno tiene proceso pero la lista vino vacía (server recién arrancado),
        // reintentar: si no, el panel muestra todas las líneas como «listas» y se pierde el turno.
        if (pid && !psel) {
          try {
            const otra = await api.procesos();
            lista = otra.procesos || [];
            psel = lista.find(x => x.id === pid);
            setProcesos(lista);
          } catch { /* queda como vino */ }
        }
        setLineasSel(psel ? psel.lineas || [] : []);
        // arrancar en el proceso del turno (no hay tablero de "toda la planta")
        if (pid) setSel('p:' + pid);
        else if (psel?.lineas?.length) setSel(psel.lineas[0]);
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
      // también el catálogo: las fallas por equipo se editan en Ajustes
      const [catFresca, tab, lin] = await Promise.all([api.catalogo(), api.tablero(), api.lineas()]);
      setCat(catFresca);
      await guardarCatalogo(catFresca);
      setMaqs(tab.maquinas);
      setLineas(lin.lineas);
      setTrama(lin.trama);
      setConexiones(lin.conexiones || []);
      await guardarTablero({ maquinas: tab.maquinas, lineas: lin.lineas, trama: lin.trama });
      api.monitor().then(setMonitor).catch(() => {});
    } catch { /* sin red: se mantiene lo que hay */ }
  }

  // Monitor del turno (SÓLO LECTURA): paradas abiertas y cerradas para el gráfico
  useEffect(() => {
    let vivo = true;
    const traer = () => api.monitor().then(m => { if (vivo) setMonitor(m); }).catch(() => {});
    traer();
    const id = setInterval(traer, 20000);
    return () => { vivo = false; clearInterval(id); };
  }, []);

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

  // Fallas asignadas a cada equipo (si tiene, el operador ve solo esas)
  const causasPorMaquina = useMemo(() => {
    const mapa = new Map();
    for (const r of (cat?.maquina_causas || [])) {
      if (!mapa.has(r.maquina_id)) mapa.set(r.maquina_id, new Set());
      mapa.get(r.maquina_id).add(r.codigo_causa_id);
    }
    return mapa;
  }, [cat]);

  function causasVisibles(maquinaId, categoriaId, todas) {
    const asignadas = causasPorMaquina.get(maquinaId);
    const filtrado = asignadas && asignadas.size > 0 && !todas;
    return (cat.causas || []).filter(c =>
      c.categoria_id === categoriaId && (!filtrado || asignadas.has(c.id)));
  }

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
    // «parada total» sólo si se detuvo el CUELLO de ESTA línea (una máquina
    // puede ser cuello en otra línea y no en ésta; el alcance guardado no
    // alcanza porque se resolvió con una sola línea)
    const total = activas.some(x => x.e.propia && trama.some(t =>
      t.linea_id === l.linea_id && t.maquina_id === x.m.id && t.detiene_linea));
    return {
      estado: total ? 'detenida' : 'parcial',
      causa: origen.e.p.causa,
      origen: origen.m.nombre_corto,
      desde: origen.e.p.hora_inicio
    };
  }

  const procesoSel = procesos.find(p => p.id === procesoId) || null;

  // Líneas ya guardadas en el turno (las que se pueden abrir para registrar fallas)
  const idsTurno = procesoSel?.lineas || [];
  const lineasTurno = idsTurno.length ? lineas.filter(l => idsTurno.includes(l.linea_id)) : [];

  // ¿cambió la selección respecto de lo guardado? así «Guardar» sólo se activa si hay algo que guardar
  const cambiosPendientes = useMemo(() => {
    const base = [...(procesoSel?.lineas || [])].sort((a, b) => a - b);
    const ahora = [...lineasSel].sort((a, b) => a - b);
    return base.length !== ahora.length || base.some((v, i) => v !== ahora[i]);
  }, [procesoSel, lineasSel]);

  // Marcar o desmarcar una línea del turno.
  function toggleLinea(lineaId) {
    setLineasSel(prev => prev.includes(lineaId)
      ? prev.filter(x => x !== lineaId)
      : [...prev, lineaId]);
  }

  // Equipos que quedarían en dos de las líneas elegidas: un equipo físico no
  // puede correr en dos líneas armadas al mismo tiempo.
  function conflictosDeTurno(ids) {
    const dueno = new Map();
    for (const t of (trama || [])) {
      if (!ids.includes(t.linea_id)) continue;
      if (!dueno.has(t.maquina_id)) dueno.set(t.maquina_id, []);
      dueno.get(t.maquina_id).push(t.linea_id);
    }
    const nombreLinea = new Map(lineas.map(l => [l.linea_id, l.nombre]));
    const nombreMaq = new Map(maqs.map(m => [m.id, m.nombre_corto]));
    return [...dueno.entries()]
      .filter(([, ls]) => new Set(ls).size > 1)
      .map(([maq, ls]) => ({
        id: maq,
        maquina: nombreMaq.get(maq) || `equipo ${maq}`,
        lineas: [...new Set(ls)].map(x => nombreLinea.get(x) || `línea ${x}`)
      }));
  }

  // Armar una línea en el momento desde el tablero: crea la línea, deja la trama
  // en el orden elegido y abre el editor para conectar los bloques.
  async function crearLineaDesdeTablero({ nombre, equipos, especie_id, producto_id }) {
    const r = await api.crearLinea({ nombre, especie_id: especie_id ?? null, producto_id: producto_id ?? null });
    const lineaId = r.linea_id ?? r.id;
    if (!lineaId) throw new Error('no se pudo crear la línea');
    await api.guardarTrama(lineaId, equipos.map((id, i) => ({
      maquina_id: id, posicion: i + 2, rama: 1, detiene_linea: false, fin_linea: false
    })), []);
    const [lin, proc] = await Promise.all([api.lineas(), api.procesos()]);
    setLineas(lin.lineas);
    setTrama(lin.trama);
    setConexiones(lin.conexiones || []);
    setProcesos(proc.procesos || []);
    setLineaRapida(null);
    setConflictoEquipos([]);
    setError(null);
    // NO entra al turno: queda armada y lista para activarla cuando se pare la línea actual
    setToast({
      titulo: 'Línea guardada',
      detalle: `${nombre} · ${equipos.length} equipos — activála cuando pares la línea actual`
    });
    const nueva = (lin.lineas || []).find(l => l.linea_id === lineaId) || { linea_id: lineaId, nombre };
    abrirEditor(nueva);
  }

  // Líneas ya armadas que NO están en el turno: quedan listas para activar cuando
  // se corte el proceso de la línea que ocupa esos equipos.
  const lineasListas = useMemo(() => {
    const conTrama = new Set((trama || []).map(t => t.linea_id));
    return lineas.filter(l => conTrama.has(l.linea_id) && !idsTurno.includes(l.linea_id));
  }, [lineas, trama, idsTurno]);

  function conQueChoca(lineaId) {
    const equipos = new Set((trama || []).filter(t => t.linea_id === lineaId).map(t => t.maquina_id));
    return lineasSel
      .filter(lid => (trama || []).some(t => t.linea_id === lid && equipos.has(t.maquina_id)))
      .map(lid => lineas.find(l => l.linea_id === lid)?.nombre)
      .filter(Boolean);
  }

  // Guarda el turno con una selección de líneas dada (sive para «Guardar cambios»
  // y para activar una línea ya armada). Devuelve true si quedó guardado.
  async function guardarTurnoCon(seleccion) {
    const rep = conflictosDeTurno(seleccion);
    if (rep.length) {
      const partes = rep.slice(0, 5).map(x => `${x.maquina} en ${x.lineas.join(' y ')}`);
      setConflictoEquipos(rep.map(x => x.id));
      setError('Estas líneas comparten equipos: ' + partes.join('; ') +
        (rep.length > 5 ? ` y ${rep.length - 5} más` : '') +
        '. Un equipo no puede estar en dos líneas armadas al mismo tiempo: detené su proceso en la ' +
        'primera línea o dejá una sola de las dos en el turno.');
      return false;
    }
    setConflictoEquipos([]);
    try {
      let id = procesoId;
      if (!id) {
        // sin armado visible: el proceso del turno se nombra con las líneas elegidas
        const nombre = seleccion
          .map(lid => lineas.find(l => l.linea_id === lid)?.nombre || '')
          .filter(Boolean).join(' + ').slice(0, 60) || 'Proceso del turno';
        const r = await api.crearReceta({ nombre });
        id = r.id;
      }
      await api.guardarEtapas(id, seleccion.map((lid, i) => ({ orden: i + 1, tipo: 'linea', linea_id: lid })));
      if (cat?.turno) await api.setProcesoTurno(cat.turno.id, id);
      setProcesoId(id);
      setLineasSel(seleccion);
      setLineasAbierto(false);
      const proc = await api.procesos();
      setProcesos(proc.procesos || []);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }

  async function guardarProcesoTurno() {
    const ok = await guardarTurnoCon(lineasSel);
    if (ok) {
      setToast({ titulo: 'Turno guardado',
                 detalle: `${lineasSel.length} ${lineasSel.length === 1 ? 'línea' : 'líneas'}` });
    }
  }

  // Abre el panel de línea nueva con el catálogo de especie/producto cargado
  async function abrirLineaRapida(equipos = []) {
    setPicker(false);
    setLineaRapida({ equipos, especies: [], productos: [], cargando: true });
    try {
      const s = await api.settings();
      setLineaRapida({ equipos, especies: s.especies || [], productos: s.productos || [] });
    } catch {
      setLineaRapida({ equipos, especies: [], productos: [] });
    }
  }

  // Activar una línea ya armada. Si para eso hay que sacar del turno líneas que
  // están usando esos equipos, primero se avisa: nada se cierra a ciegas.
  function activarLinea(lineaId) {
    const equipos = new Set((trama || []).filter(t => t.linea_id === lineaId).map(t => t.maquina_id));
    const salen = lineasSel
      .filter(lid => (trama || []).some(t => t.linea_id === lid && equipos.has(t.maquina_id)))
      .map(lid => {
        const l = lineas.find(x => x.linea_id === lid);
        const detenidas = (trama || [])
          .filter(t => t.linea_id === lid)
          .filter(t => {
            const m = maqs.find(x => x.id === t.maquina_id);
            return m && estadoDe(m).tipo !== 'run';
          }).length;
        return { id: lid, nombre: l ? l.nombre : `línea ${lid}`, detenidas };
      });
    const nombre = lineas.find(l => l.linea_id === lineaId)?.nombre || 'La línea';

    if (salen.length) {
      setConfirmarActivacion({ lineaId, nombre, salen });
      return;
    }
    guardarTurnoCon([...lineasSel, lineaId]).then(ok => {
      if (ok) setToast({ titulo: 'Línea activada', detalle: `${nombre} · se sumó al turno` });
    });
  }

  async function confirmarActivacionYGuardar() {
    const conf = confirmarActivacion;
    if (!conf) return;
    setConfirmarActivacion(null);
    const salenIds = conf.salen.map(s => s.id);
    const seleccion = [...lineasSel.filter(lid => !salenIds.includes(lid)), conf.lineaId];
    const ok = await guardarTurnoCon(seleccion);
    if (ok) {
      setToast({
        titulo: 'Línea activada',
        detalle: `${conf.nombre} · salió ${conf.salen.map(s => s.nombre).join(' y ')}`
      });
    }
  }

  // Fin de turno: detiene las líneas armadas con la causa «Fin de turno»,
  // cierra el corte de proceso y deja el turno cerrado.
  async function cerrarTurno() {
    setConfirmarCierre(false);
    try {
      const r = await api.cerrarTurno();
      await refrescar();
      api.monitor().then(setMonitor).catch(() => {});
      setToast({
        titulo: 'Turno cerrado',
        detalle: `${r?.paradas || 0} línea${(r?.paradas || 0) === 1 ? '' : 's'} detenida${(r?.paradas || 0) === 1 ? '' : 's'} por fin de turno`
      });
    } catch (e) {
      setError(e.message);
    }
  }

  // Mover un equipo de esta línea a otra (cambia de proceso, no se duplica)
  async function moverEquipo(maquinaId, destinoId) {
    if (!editor) return;
    try {
      await api.moverEquipo(editor.linea.linea_id, { maquina_id: maquinaId, destino_id: destinoId });
      setEditor(prev => ({
        ...prev,
        filas: prev.filas.filter(f => f.maquina_id !== maquinaId),
        conexiones: (prev.conexiones || []).filter(c =>
          c.desde_maquina_id !== maquinaId && c.hasta_maquina_id !== maquinaId),
        error: null
      }));
      setSeleccionada(prev => (prev === maquinaId ? null : prev));
      const destino = lineas.find(l => l.linea_id === destinoId)?.nombre || 'la otra línea';
      setToast({ titulo: 'Equipo movido', detalle: `${nombreCorto(maquinaId)} → ${destino}` });
      const lin = await api.lineas();
      setLineas(lin.lineas);
      setTrama(lin.trama);
      setConexiones(lin.conexiones || []);
    } catch (e) {
      setEditor(prev => ({ ...prev, error: e.message }));
    }
  }

  // Tiempo de trabajo de la línea en el proceso actual: desde el corte abierto
  // (o el inicio del turno) hasta ahora, descontando lo que estuvo parada.
  function tiempoLinea(l) {
    if (!l) return null;
    const corte = (monitor?.cortes || []).find(c => !c.hasta);
    const desde = corte?.desde || monitor?.turno?.creado_en;
    if (!desde) return null;
    const ini = new Date(desde).getTime();
    const ahoraMs = ahora;
    const total = Math.max(0, Math.round((ahoraMs - ini) / 60000));
    const maquinas = new Set((trama || [])
      .filter(t => t.linea_id === l.linea_id).map(t => t.maquina_id));
    let paradaMs = 0;
    for (const p of (monitor?.paradas || [])) {
      if (!maquinas.has(p.maquina_id)) continue;
      const a = Math.max(new Date(p.hora_inicio).getTime(), ini);
      const b = Math.min(p.hora_fin ? new Date(p.hora_fin).getTime() : ahoraMs, ahoraMs);
      if (b > a) paradaMs += b - a;
    }
    const parada = Math.min(total, Math.round(paradaMs / 60000));
    return { total, parada, trabajo: Math.max(0, total - parada) };
  }

  // Detener el proceso completo: la parada va sobre el cuello de la línea (o su
  // Eventualidades), que por definición arrastra toda la línea.
  function detenerProceso() {
    if (!lineaActual) return;
    const propias = (trama || []).filter(t => t.linea_id === lineaActual.linea_id);
    const cuello = propias.find(t => t.detiene_linea);
    const even = propias.find(t => (maqs.find(m => m.id === t.maquina_id)?.nombre_corto || '')
      .startsWith('Eventualidades'));
    const elegida = cuello || even || propias[0];
    if (!elegida) return;
    const m = maqs.find(x => x.id === elegida.maquina_id);
    if (!m) return;
    setSheet({
      tipo: 'categorias',
      maquina: { ...m, linea_id: lineaActual.linea_id, posicion: elegida.posicion,
                 detiene_linea: Boolean(cuello) }
    });
  }

  // Con un proceso elegido, el tablero muestra solo las máquinas de sus líneas
  const maqsVisibles = useMemo(() => {
    if (!lineasSel.length) return maqs;
    const ids = new Set(
      (trama || []).filter(t => lineasSel.includes(t.linea_id)).map(t => t.maquina_id));
    return maqs.filter(m => ids.has(m.id));
  }, [maqs, trama, lineasSel]);

  const lineaActual = (sel === 'todas' || String(sel).startsWith('p:'))
    ? null
    : lineas.find(l => l.linea_id === sel);

  // ---- datos del monitor (sólo lectura) ----
  const filasMonitor = lineasTurno.map(l => {
    const st = estadoLinea(l);
    return {
      id: l.linea_id,
      nombre: l.nombre,
      maquinas: l.maquinas,
      estado: st.estado,
      causa: st.causa,
      origen: st.origen,
      tiempo: st.estado === 'operando' ? '' : (minutos(st.desde, ahora) === '0 min' ? 'recién' : minutos(st.desde, ahora)),
      trabajo: (tiempoLinea(l) || {}).trabajo
    };
  });

  // minutos perdidos por línea y por causa: suma de las paradas del turno
  const perdidas = useMemo(() => {
    const paradas = monitor?.paradas || [];
    const dueno = new Map();          // maquina_id -> [linea_id]
    for (const t of (trama || [])) {
      if (!dueno.has(t.maquina_id)) dueno.set(t.maquina_id, []);
      dueno.get(t.maquina_id).push(t.linea_id);
    }
    const ids = new Set(idsTurno);
    const porLinea = new Map();
    const porCausa = new Map();
    let total = 0;
    let abiertas = 0;
    for (const p of paradas) {
      total += p.minutos;
      if (p.estado === 'activa') abiertas += 1;
      for (const lid of (dueno.get(p.maquina_id) || [])) {
        if (ids.size && !ids.has(lid)) continue;
        porLinea.set(lid, (porLinea.get(lid) || 0) + p.minutos);
      }
      porCausa.set(p.causa, (porCausa.get(p.causa) || 0) + p.minutos);
    }
    const nombre = new Map(lineas.map(l => [l.linea_id, l.nombre]));
    const aLista = (mapa, tope) => {
      const arr = [...mapa.entries()]
        .map(([k, min]) => ({ key: String(k), nombre: nombre.get(Number(k)) || k, min }))
        .filter(x => x.min > 0)
        .sort((a, b) => b.min - a.min);
      const tope1 = arr.slice(0, tope);
      const max = Math.max(1, ...tope1.map(x => x.min));
      return tope1.map(x => ({ ...x, pct: Math.round((x.min / max) * 100) }));
    };
    return {
      total, abiertas, n: paradas.length,
      porLinea: aLista(porLinea, 8),
      porCausa: aLista(porCausa, 6)
    };
  }, [monitor, trama, idsTurno, lineas]);

  const maquinasLinea = useMemo(() => {
    if (!lineaActual) return [];
    return trama
      .filter(t => t.linea_id === lineaActual.linea_id)
      .sort((a, b) => a.posicion - b.posicion)
      .map(t => {
        const m = maqs.find(x => x.id === t.maquina_id);
        return m ? { ...m, posicion: t.posicion, rama: t.rama || 1, detiene_linea: t.detiene_linea } : null;
      })
      .filter(Boolean);
  }, [lineaActual, trama, maqs]);

  // Afectadas por propagación en la línea visible: un bloque con varias
  // entradas solo se detiene si TODAS sus entradas están detenidas.
  const afectadasLinea = useMemo(() => {
    const mapa = new Map();
    if (!lineaActual) return mapa;
    const propias = new Set();
    let alcanceLinea = false;
    // «cuello» se toma de la trama de ESTA línea (una máquina puede estar en
    // varias líneas y ser cuello solo en una).
    const esCuello = (id) => (trama || []).some(t =>
      t.linea_id === lineaActual.linea_id && t.maquina_id === id && t.detiene_linea);

    for (const m of maquinasLinea) {
      const e = estadoDe(m);
      if (e.tipo === 'stop' || e.tipo === 'plan') {
        propias.add(m.id);
        // El cuello se lee de la trama de ESTA línea: el alcance guardado en la
        // parada se resolvió con una sola línea y una máquina puede ser cuello
        // en otra, apagando toda la línea sin motivo.
        if (esCuello(m.id)) alcanceLinea = true;
      }
    }
    const stop = new Set(propias);
    // Con conexiones, «detiene la línea» significa su rama (sus descendientes),
    // no toda la planta: las otras ramas siguen produciendo.
    // Un bloque marcado como cuello detiene la línea completa, tenga o no
    // conexiones dibujadas (es el criterio del cuello).
    if (alcanceLinea) {
      for (const m of maquinasLinea) stop.add(m.id);
    } else {
      const edges = (conexiones || []).filter(c => c.linea_id === lineaActual.linea_id);

      // Dirección según la causa: una limpieza por acumulación también detiene
      // lo que alimenta a ese bloque (aguas arriba).
      const dirPorCausa = new Map((cat?.causas || []).map(c => [c.descripcion, c.direccion || 'abajo']));
      const arriba = new Set();
      let detenerTodo = false;
      for (const m of maquinasLinea) {
        if (!stop.has(m.id)) continue;
        const dir = dirPorCausa.get(estadoDe(m).p?.causa) || 'abajo';
        if (dir === 'ambas') detenerTodo = true;
        else if (dir === 'arriba') arriba.add(m.id);
      }

      if (detenerTodo) {
        for (const m of maquinasLinea) stop.add(m.id);
      } else {
        // subir por las conexiones (cualquier padre detenido arrastra)
        const pila = [...arriba];
        while (pila.length) {
          const id = pila.pop();
          for (const e of edges.filter(x => x.hasta_maquina_id === id)) {
            if (!stop.has(e.desde_maquina_id)) {
              stop.add(e.desde_maquina_id);
              pila.push(e.desde_maquina_id);
            }
          }
        }
        // Conexiones de retorno (lazos): si A recibe de B y B recibe de A,
        // la flecha de vuelta significa «cuando B se para, A también».
        const alcanzaDesde = (o, d, visto = new Set()) => {
          if (o === d) return true;
          if (visto.has(o)) return false;
          // un `visto` compartido entre ramas poda caminos válidos: cada rama
          // lleva su propia copia o el lazo deja de propagar según el orden
          const siguiente = new Set(visto).add(o);
          return edges.filter(e => e.desde_maquina_id === o)
                      .some(e => alcanzaDesde(e.hasta_maquina_id, d, siguiente));
        };
        let cambioLazo = true, guardaLazo = 0;
        while (cambioLazo && guardaLazo++ < 10) {
          cambioLazo = false;
          for (const e of edges) {
            const esRetorno = alcanzaDesde(e.hasta_maquina_id, e.desde_maquina_id);
            if (esRetorno && stop.has(e.desde_maquina_id) && !stop.has(e.hasta_maquina_id)) {
              stop.add(e.hasta_maquina_id);
              cambioLazo = true;
            }
          }
        }

        // bajar: un bloque con varias entradas solo cae si todas cayeron
        let cambio = true, guarda = 0;
        while (cambio && guarda++ < 20) {
          cambio = false;
          for (const m of maquinasLinea) {
            if (stop.has(m.id)) continue;
            const padres = edges.filter(e => e.hasta_maquina_id === m.id).map(e => e.desde_maquina_id);
            if (padres.length && padres.every(p => stop.has(p))) {
              stop.add(m.id);
              cambio = true;
            }
          }
        }
      }
    }
    for (const m of maquinasLinea) {
      if (stop.has(m.id) && !propias.has(m.id)) {
        // el origen es la entrada que realmente está detenida
        let origen = (conexiones || [])
          .filter(c => c.hasta_maquina_id === m.id && stop.has(c.desde_maquina_id))
          .map(c => maquinasLinea.find(x => x.id === c.desde_maquina_id)?.nombre_corto)
          .filter(Boolean)[0];
        if (!origen) {
          // arrastre aguas arriba: el origen es la máquina que se detuvo
          origen = maquinasLinea.find(x => propias.has(x.id))?.nombre_corto;
        }
        mapa.set(m.id, origen || 'otra etapa');
      }
    }
    return mapa;
  }, [lineaActual, maquinasLinea, conexiones, locales, cerradas, trama, cat]);


  // columnas de la línea: cada etapa con sus ramas en paralelo
  const columnasLinea = useMemo(() => {
    const mapa = new Map();
    for (const m of maquinasLinea) {
      if (!mapa.has(m.posicion)) mapa.set(m.posicion, []);
      mapa.get(m.posicion).push(m);
    }
    return [...mapa.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([pos, filas]) => ({ pos, filas: filas.sort((x, y) => x.rama - y.rama) }));
  }, [maquinasLinea]);


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

    // pintado inmediato: sólo la máquina tocada. El arrastre lo calcula
    // afectadasLinea con las CONEXIONES de la trama (por eso las flechas mandan).
    setLocales(prev => ({ ...prev, [maq.id]: parada }));
    try {
      const evId = await encolar({
        tipo: 'abrir', uuid, maquina_id: maq.id, causa_id: causa.id,
        hora_inicio: inicio, impacto: 'Total',
        linea_id: maq.linea_id ?? null   // el alcance se resuelve en ESTA línea
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

  const conexionesSalidaDe = (id) => (editor?.conexiones || []).filter(c => c.desde_maquina_id === id);
  function colorFuente(id) {
    const fuentes = [...new Set((editor?.conexiones || []).map(c => c.desde_maquina_id))];
    return PALETA[fuentes.indexOf(id) % PALETA.length];
  }
  const entradasDe = (id) => (editor?.conexiones || [])
    .filter(c => c.hasta_maquina_id === id)
    .map(c => c.desde_maquina_id);
  const nombreCorto = (id) => editor?.filas.find(f => f.maquina_id === id)?.nombre_corto || '?';

  // Cada equipo cae en una columna segun cuantos saltos lo separan del inicio
  // (siguiendo las conexiones «entra de»).
  function conNiveles(filas, cons) {
    const porId = new Map(filas.map(f => [f.maquina_id, f]));
    // Línea sin conexiones propias: se mantiene el orden guardado
    const ids = new Set(filas.map(f => f.maquina_id));
    const propias = (cons || []).filter(c =>
      ids.has(c.desde_maquina_id) && ids.has(c.hasta_maquina_id));
    if (!propias.length) {
      return filas.map(f => ({ ...f, posicion: f.posicion || 1, rama: f.rama || 1 }));
    }
    const entradas = new Map();
    for (const c of propias) {
      if (!entradas.has(c.hasta_maquina_id)) entradas.set(c.hasta_maquina_id, []);
      entradas.get(c.hasta_maquina_id).push(c.desde_maquina_id);
    }
    const nivel = new Map();
    const calc = (id, visto) => {
      if (nivel.has(id)) return nivel.get(id);
      const ps = (entradas.get(id) || []).filter(p => porId.has(p));
      if (!ps.length || visto.has(id)) { nivel.set(id, 0); return 0; }
      visto.add(id);
      const n = Math.min(Math.max(...ps.map(p => calc(p, visto))) + 1, 12);
      nivel.set(id, n);
      return n;
    };
    for (const f of filas) calc(f.maquina_id, new Set());

    const porNivel = new Map();
    for (const f of filas) {
      const n = nivel.get(f.maquina_id);
      if (!porNivel.has(n)) porNivel.set(n, []);
      porNivel.get(n).push(f);
    }
    const rama = new Map();
    for (const [, lista] of porNivel) {
      lista.sort((a, b) => a.rama - b.rama).forEach((f, i) => rama.set(f.maquina_id, i + 1));
    }
    return filas.map(f => ({
      ...f,
      posicion: nivel.get(f.maquina_id) + 1,
      rama: rama.get(f.maquina_id)
    }));
  }

  const columnasEditor = useMemo(() => {
    if (!editor) return [];
    const filas = editor.filas;
    const mapa = new Map();
    for (const f of filas) {
      if (!mapa.has(f.posicion)) mapa.set(f.posicion, []);
      mapa.get(f.posicion).push(f);
    }
    return [...mapa.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([pos, lista]) => ({ pos, filas: lista.sort((x, y) => x.rama - y.rama) }));
  }, [editor]);

  // ---- editor de trama ----
  async function abrirEditor(lineaParam) {
    // si llega el evento del onClick en vez de una línea, se usa la que se está viendo
    const esLinea = lineaParam && typeof lineaParam === 'object'
      && (lineaParam.linea_id != null || lineaParam.id != null)
      && !lineaParam.nativeEvent;
    const linea = esLinea ? lineaParam : lineaActual;
    if (!linea) return;
    const lineaId = linea.linea_id ?? linea.id;

    // Traer la trama fresca: si se editó el nombre de un equipo en Ajustes, la
    // tarjeta tiene que mostrarlo (el estado del tablero puede venir de antes).
    let fuente = trama;
    try {
      const [lin, tab] = await Promise.all([api.lineas(), api.tablero()]);
      fuente = lin.trama;
      setTrama(lin.trama);
      setLineas(lin.lineas);
      setConexiones(lin.conexiones || []);
      setMaqs(tab.maquinas);
    } catch { /* sin red: se usa lo que hay en memoria */ }

    const filas = fuente
      .filter(t => t.linea_id === lineaId)
      .sort((a, b) => a.posicion - b.posicion)
      .map(t => ({
        maquina_id: t.maquina_id, nombre_corto: t.nombre_corto,
        area: t.area, detiene_linea: t.detiene_linea, fin_linea: Boolean(t.fin_linea),
        posicion: t.posicion, rama: t.rama || 1,
        x: t.pos_x ?? 30 + ((t.posicion || 1) - 1) * 330,
        y: t.pos_y ?? 24 + ((t.rama || 1) - 1) * 300
      }));
    const cons = (conexiones || [])
      .filter(c => c.linea_id === lineaId)
      .map(c => ({ desde_maquina_id: c.desde_maquina_id, hasta_maquina_id: c.hasta_maquina_id }));
    setSeleccionada(null);
    setPicker(false);
    setPickerBuscar('');
    setEditor({ linea: { ...linea, linea_id: lineaId }, filas, conexiones: cons,
                nueva: '', error: null, guardando: false });
  }

  function editar(fn) {
    setEditor(prev => {
      const e = { ...prev, filas: fn(prev.filas) };
      return e;
    });
  }

  // arrastrar la tarjeta libremente por el lienzo
  function iniciarMover(e, f) {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest('.tf-port, button, input, select, label')) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY, ox = f.x, oy = f.y;
    setMoviendo(f.maquina_id);
    const mover = (ev) => {
      const dx = (ev.clientX - x0) / zoom, dy = (ev.clientY - y0) / zoom;
      setEditor(prev => ({
        ...prev,
        filas: prev.filas.map(k => k.maquina_id === f.maquina_id
          ? { ...k, x: Math.max(0, Math.round(ox + dx)), y: Math.max(0, Math.round(oy + dy)) }
          : k)
      }));
    };
    const soltar = () => {
      setMoviendo(null);
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      setEditor(prev => {
        const filas = prev.filas;
        const etapaDe = etapaVisual(filas);
        const antes = etapaDe(ox), ahora = etapaDe(filas.find(k => k.maquina_id === f.maquina_id)?.x);
        if (antes !== ahora) {
          setTimeout(() => setAvisoEditor(
            `Moviste ${f.nombre_corto} a la etapa ${ahora}. Sus conexiones se mantienen: revisá que la rama siga bien.`
          ), 0);
        }
        return prev;
      });
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  // franjas verticales que marcan las etapas en el lienzo
  const guias = useMemo(() => {
    const filas = editor?.filas || [];
    if (!filas.length) return [];
    const xs = [...new Set(filas.map(f => f.x ?? 0))].sort((a, b) => a - b);
    const bandas = [];
    for (const x of xs) {
      const ultima = bandas[bandas.length - 1];
      if (ultima && x - ultima.max <= 120) ultima.max = x;
      else bandas.push({ min: x, max: x });
    }
    return bandas.map((b, i) => ({ n: i + 1, x: b.min }));
  }, [editor]);

  function etapaVisual(filas) {
    const xs = [...new Set(filas.map(f => f.x ?? 0))].sort((a, b) => a - b);
    const bandas = [];
    for (const x of xs) {
      const ultima = bandas[bandas.length - 1];
      if (ultima && x - ultima.max <= 120) ultima.max = x;
      else bandas.push({ min: x, max: x });
    }
    return (x) => {
      const i = bandas.findIndex(b => (x ?? 0) >= b.min && (x ?? 0) <= b.max);
      return (i < 0 ? 0 : i) + 1;
    };
  }

  // Tarjetas con la conexión incompleta: sueltas, sin salida o sin entrada
  const avisos = useMemo(() => {
    if (!editor) return [];
    const filas = editor.filas;
    const ids = new Set(filas.map(f => f.maquina_id));
    const cons = (editor.conexiones || []).filter(c =>
      ids.has(c.desde_maquina_id) && ids.has(c.hasta_maquina_id));
    const entradas = new Map(), salidas = new Map();
    for (const c of cons) {
      salidas.set(c.desde_maquina_id, (salidas.get(c.desde_maquina_id) || 0) + 1);
      entradas.set(c.hasta_maquina_id, (entradas.get(c.hasta_maquina_id) || 0) + 1);
    }
    const etapaDe = etapaVisual(filas);
    const out = [];
    for (const f of filas) {
      const e = entradas.get(f.maquina_id) || 0;
      const sal = salidas.get(f.maquina_id) || 0;
      const etapa = etapaDe(f.x);
      if (!e && !sal) {
        out.push({ id: f.maquina_id, tipo: 'suelta', texto: `${f.nombre_corto}: sin conexiones` });
      } else if (!sal && filas.length > 1 && !f.fin_linea) {
        out.push({ id: f.maquina_id, tipo: 'sin_salida', texto: `${f.nombre_corto}: no alimenta a ningún bloque` });
      } else if (!e && etapa > 1) {
        out.push({ id: f.maquina_id, tipo: 'sin_entrada', texto: `${f.nombre_corto}: está en la etapa ${etapa} y no recibe de nadie` });
      }
    }
    return out;
  }, [editor]);

  const ANCHO_TARJETA = 262, ALTO_TARJETA = 296;

  function haySolape(x, y, filas) {
    return filas.some(f => Math.abs((f.x || 0) - x) < ANCHO_TARJETA && Math.abs((f.y || 0) - y) < ALTO_TARJETA);
  }

  // La tarjeta nueva va al final del flujo: debajo de la última etapa,
  // alineada con esa columna. Si no cabe, abre una etapa nueva a la derecha.
  function huecoParaNueva(filas) {
    if (!filas.length) return { x: 30, y: 24 };
    const etapaDe = etapaVisual(filas);
    const maxEtapa = Math.max(...filas.map(f => etapaDe(f.x)));
    const ultima = filas.filter(f => etapaDe(f.x) === maxEtapa);
    const x = ultima[0].x ?? 30;
    const y = Math.max(...ultima.map(f => f.y || 0)) + ALTO_TARJETA + 12;
    if (!haySolape(x, y, filas)) return { x, y };
    const nuevaX = Math.max(...filas.map(f => f.x || 0)) + ANCHO_TARJETA + 24;
    return { x: nuevaX, y: 24 };
  }

  // corre hacia abajo las tarjetas que se pisan, sin cambiar el orden general
  function acomodar(filas) {
    const colocadas = [];
    for (const f of [...filas].sort((a, b) => (a.x || 0) - (b.x || 0) || (a.y || 0) - (b.y || 0))) {
      let y = f.y || 24, guarda = 0;
      while (haySolape(f.x || 0, y, colocadas) && guarda++ < 80) y += ALTO_TARJETA + 12;
      colocadas.push({ ...f, y });
    }
    return colocadas;
  }

  // tamaño del lienzo según la tarjeta más lejana
  const lienzo = useMemo(() => {
    const filas = editor?.filas || [];
    const w = Math.max(2800, ...filas.map(f => (f.x || 0) + 700));
    const h = Math.max(1700, ...filas.map(f => (f.y || 0) + 500));
    return { w, h };
  }, [editor]);

  // La etapa del tablero sale de la posición horizontal: las tarjetas que están
  // en la misma franja de x comparten etapa, y dentro de ella se ordenan por y.
  function etapasDesdeLienzo(filas) {
    if (!filas.length) return filas;
    const xs = [...new Set(filas.map(f => f.x ?? 0))].sort((a, b) => a - b);
    const bandas = [];
    for (const x of xs) {
      const ultima = bandas[bandas.length - 1];
      if (ultima && x - ultima.max <= 120) ultima.max = x;
      else bandas.push({ min: x, max: x });
    }
    const etapaDe = (x) => {
      const i = bandas.findIndex(b => x >= b.min && x <= b.max);
      return (i < 0 ? 0 : i) + 1;
    };
    const conEtapa = filas.map(f => ({ ...f, posicion: etapaDe(f.x ?? 0) }));
    const porEtapa = new Map();
    for (const f of conEtapa) {
      if (!porEtapa.has(f.posicion)) porEtapa.set(f.posicion, []);
      porEtapa.get(f.posicion).push(f);
    }
    const rama = new Map();
    for (const [, lista] of porEtapa) {
      lista.sort((a, b) => (a.y ?? 0) - (b.y ?? 0)).forEach((f, i) => rama.set(f.maquina_id, i + 1));
    }
    return conEtapa
      .map(f => ({ ...f, rama: rama.get(f.maquina_id) }))
      .sort((a, b) => a.posicion - b.posicion || a.rama - b.rama);
  }

  // etapas y ramas densas: 1..N, sin huecos
  function renum(lista) {
    const posiciones = [...new Set(lista.map(f => f.posicion))].sort((a, b) => a - b);
    const posMap = new Map(posiciones.map((p, i) => [p, i + 1]));
    const conPos = lista.map(f => ({ ...f, posicion: posMap.get(f.posicion) }));

    const porEtapa = new Map();
    for (const f of conPos) {
      if (!porEtapa.has(f.posicion)) porEtapa.set(f.posicion, []);
      porEtapa.get(f.posicion).push(f);
    }
    const ramaMap = new Map();
    for (const [, lista2] of porEtapa) {
      lista2.sort((a, b) => a.rama - b.rama).forEach((f, i) => ramaMap.set(f.maquina_id, i + 1));
    }
    return conPos
      .map(f => ({ ...f, rama: ramaMap.get(f.maquina_id) }))
      .sort((a, b) => a.posicion - b.posicion || a.rama - b.rama);
  }

  function enfocar(maquinaId) {
    requestAnimationFrame(() => {
      const el = document.getElementById('tr-' + maquinaId);
      if (el) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 700);
      }
    });
  }

  // mover entre etapas (adelante / atrás en el flujo)
  const moverEtapa = (maquinaId, dir) => {
    if (!editor) return;
    const f = editor.filas.find(x => x.maquina_id === maquinaId);
    if (!f) return;
    const max = Math.max(...editor.filas.map(x => x.posicion));
    const destino = Math.min(Math.max(f.posicion + dir, 1), max + 1);
    if (destino === f.posicion) return;
    editar(filas => renum(filas.map(x =>
      x.maquina_id === maquinaId ? { ...x, posicion: destino, rama: 999 } : x)));
    enfocar(maquinaId);
  };

  // mover dentro de la misma etapa: intercambia con la rama vecina
  const moverRama = (maquinaId, dir) => {
    if (!editor) return;
    const f = editor.filas.find(x => x.maquina_id === maquinaId);
    if (!f) return;
    const enEtapa = editor.filas
      .filter(x => x.posicion === f.posicion)
      .sort((a, b) => a.rama - b.rama);
    const i = enEtapa.findIndex(x => x.maquina_id === maquinaId);
    const j = i + dir;
    if (j < 0 || j >= enEtapa.length) return;
    const vecina = enEtapa[j];
    editar(filas => renum(filas.map(x => {
      if (x.maquina_id === maquinaId) return { ...x, rama: vecina.rama };
      if (x.maquina_id === vecina.maquina_id) return { ...x, rama: f.rama };
      return x;
    })));
    enfocar(maquinaId);
  };

  // ---- arrastrar y soltar (mouse) ----
  function soltarEnCard(dragId, destinoId, despues) {
    if (!dragId || dragId === destinoId) return;
    editar(filas => {
      const dest = filas.find(f => f.maquina_id === destinoId);
      if (!dest) return filas;
      const rama = dest.rama + (despues ? 0.5 : -0.5);
      return renum(filas.map(f =>
        f.maquina_id === dragId ? { ...f, posicion: dest.posicion, rama } : f));
    });
    setSobre(null);
    setArrastre(null);
    enfocar(dragId);
  }

  function conectar(dragId, destinoId) {
    if (!dragId || dragId === destinoId) return;
    setEntrada(dragId, destinoId, true);
    setSobre(null);
    setArrastre(null);
    enfocar(dragId);
  }

  function soltarEnEtapa(dragId, posicion) {
    if (!dragId) return;
    editar(filas => {
      const enEtapa = filas.filter(f => f.posicion === posicion).length;
      return renum(filas.map(f =>
        f.maquina_id === dragId ? { ...f, posicion, rama: enEtapa + 0.5 } : f));
    });
    setSobre(null);
    setArrastre(null);
    enfocar(dragId);
  }

  function soltarEnNuevaEtapa(dragId) {
    if (!dragId) return;   // queda como inicio de línea
    setSobre(null);
    setArrastre(null);
    enfocar(dragId);
  }

  function intentarConectar(destinoId, origenId) {
    if (!editor || !origenId || destinoId === origenId) return false;
    const cons = editor.conexiones || [];
    const alcanza = (o, d, visto = new Set()) => {
      if (o === d) return true;
      if (visto.has(o)) return false;
      visto.add(o);
      return cons.filter(c => c.desde_maquina_id === o)
                 .some(c => alcanza(c.hasta_maquina_id, d, visto));
    };
    const enLazo = alcanza(destinoId, origenId);
    setEntrada(destinoId, origenId, true);
    setAvisoEditor(enLazo
      ? `Conexión en lazo: ${nombreCorto(origenId)} → ${nombreCorto(destinoId)}. ` +
        'La parada se propaga igual, pero revisá si es lo que querés.'
      : null);
    return true;
  }

  function setEntrada(maquinaId, desdeId, agregar) {
    if (!editor || !desdeId) return;
    if (agregar && desdeId === maquinaId) return;
    setEditor(prev => {
      let cons = [...(prev.conexiones || [])];
      if (agregar) {
        if (!cons.some(c => c.desde_maquina_id === desdeId && c.hasta_maquina_id === maquinaId)) {
          cons.push({ desde_maquina_id: desdeId, hasta_maquina_id: maquinaId });
        }
      } else {
        cons = cons.filter(c => !(c.desde_maquina_id === desdeId && c.hasta_maquina_id === maquinaId));
      }
      return { ...prev, conexiones: cons };
    });
  }

  const quitar = (maquinaId) => setEditor(prev => ({
    ...prev,
    filas: prev.filas.filter(f => f.maquina_id !== maquinaId),
    conexiones: (prev.conexiones || []).filter(c =>
      c.desde_maquina_id !== maquinaId && c.hasta_maquina_id !== maquinaId)
  }));

  const marcarCuello = (maquinaId) =>
    editar(filas => filas.map(f => ({ ...f, detiene_linea: f.maquina_id === maquinaId })));

  // fin de línea: la última tarjeta del proceso (puede no tener salidas)
  const alternarFin = (maquinaId) =>
    editar(filas => filas.map(f => f.maquina_id === maquinaId
      ? { ...f, fin_linea: !f.fin_linea }
      : f));

  function agregarMaquina(idParam) {
    const id = Number(idParam ?? editor?.nueva);
    if (!id) return;
    const m = maqs.find(x => x.id === id);
    if (!m) return;
    if (editor.filas.some(f => f.maquina_id === m.id)) return;
    const maxPos = editor.filas.length ? Math.max(...editor.filas.map(f => f.posicion)) : 0;
    const hueco = huecoParaNueva(editor.filas);
    editar(filas => renum([...filas, {
      maquina_id: m.id, nombre_corto: m.nombre_corto, area: m.area,
      detiene_linea: false, fin_linea: false, posicion: maxPos + 1, rama: 1,
      x: hueco.x, y: hueco.y
    }]));
    setEditor(prev => ({ ...prev, nueva: '' }));
    setSeleccionada(m.id);
    requestAnimationFrame(() => {
      const el = document.getElementById('tr-' + m.id);
      if (el) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 900);
      }
    });
  }

  async function guardarTrama() {
    setEditor(prev => ({ ...prev, guardando: true, error: null }));
    try {
      const orden = etapasDesdeLienzo(editor.filas);
      await api.guardarTrama(editor.linea.linea_id,
        orden.map(f => ({
          maquina_id: f.maquina_id, detiene_linea: f.detiene_linea,
          fin_linea: Boolean(f.fin_linea),
          posicion: f.posicion, rama: f.rama,
          pos_x: f.x ?? null, pos_y: f.y ?? null
        })),
        editor.conexiones || []
      );
      const [tab, lin] = await Promise.all([api.tablero(), api.lineas()]);
      setMaqs(tab.maquinas);
      setLineas(lin.lineas);
      setTrama(lin.trama);
      setConexiones(lin.conexiones || []);
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

  // lista del panel de agregar, filtrada por lo que se escribe
  const disponiblesPick = useMemo(() => {
    const t = sinTildes(pickerBuscar);
    if (!t) return disponibles;
    return disponibles.filter(m => sinTildes(`${m.nombre_corto} ${m.area}`).includes(t));
  }, [disponibles, pickerBuscar]);

  // En qué otras líneas está un equipo (para avisar antes de agregarlo)
  function lineasDeMaquina(maquinaId) {
    return (trama || [])
      .filter(t => t.maquina_id === maquinaId && t.linea_id !== editor?.linea?.linea_id)
      .map(t => {
        const l = lineas.find(x => x.linea_id === t.linea_id);
        return { id: t.linea_id, nombre: l?.nombre || `línea ${t.linea_id}`,
                 armada: idsTurno.includes(t.linea_id) };
      });
  }

  // Sugerencias al elegir una tarjeta: los bloques de la etapa anterior que
  // todavía no le entran y los de la siguiente que todavía no salen de ella.
  const sugerencias = useMemo(() => {
    const vacio = { entrada: [], salida: [] };
    if (!editor || !seleccionada) return vacio;
    const filas = editor.filas;
    const f = filas.find(x => x.maquina_id === seleccionada);
    if (!f) return vacio;
    const etapaDe = etapaVisual(filas);
    const etapa = etapaDe(f.x);
    const cons = editor.conexiones || [];
    const ent = new Set(cons.filter(c => c.hasta_maquina_id === seleccionada).map(c => c.desde_maquina_id));
    const sal = new Set(cons.filter(c => c.desde_maquina_id === seleccionada).map(c => c.hasta_maquina_id));
    const enEtapa = (n) => filas.filter(x => x.maquina_id !== seleccionada && etapaDe(x.x) === n);
    return {
      entrada: enEtapa(etapa - 1).filter(x => !ent.has(x.maquina_id)),
      salida: enEtapa(etapa + 1).filter(x => !sal.has(x.maquina_id))
    };
  }, [editor, seleccionada]);

  // Líneas visibles entre bloques (estilo n8n)
  useEffect(() => {
    if (!editor) { setLinks([]); return; }
    const calc = () => {
      const cont = flowRef.current;
      if (!cont) return;
      const base = cont.getBoundingClientRect();
      const fuentes = [...new Set((editor.conexiones || []).map(c => c.desde_maquina_id))];
      const out = [];
      for (const c of (editor.conexiones || [])) {
        const a = document.getElementById('tr-' + c.desde_maquina_id);
        const b = document.getElementById('tr-' + c.hasta_maquina_id);
        if (!a || !b) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const x1 = (ra.right - base.left) / zoom + cont.scrollLeft;
        const y1 = (ra.top + ra.height / 2 - base.top) / zoom + cont.scrollTop;
        const x2 = (rb.left - base.left) / zoom + cont.scrollLeft;
        const y2 = (rb.top + rb.height / 2 - base.top) / zoom + cont.scrollTop;
        const dx = Math.max(30, Math.abs(x2 - x1) * 0.45);
        const d = x2 >= x1
          ? `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
          : `M ${x1} ${y1} C ${x1 - dx} ${y1}, ${x2 + dx} ${y2}, ${x2} ${y2}`;
        out.push({
          k: c.desde_maquina_id + '-' + c.hasta_maquina_id,
          desde: c.desde_maquina_id,
          color: PALETA[fuentes.indexOf(c.desde_maquina_id) % PALETA.length],
          x1, y1, x2, y2, d
        });
      }
      setDims({ w: cont.scrollWidth, h: cont.scrollHeight });
      setLinks(out);
    };
    const t = setTimeout(calc, 90);
    window.addEventListener('resize', calc);
    return () => { clearTimeout(t); window.removeEventListener('resize', calc); };
  }, [editor]);

  // Arrastrar desde el puerto de salida para conectar (estilo n8n)
  function iniciarCable(e, desdeId, lado = 'der') {
    e.preventDefault();
    e.stopPropagation();
    const cont = flowRef.current;
    if (!cont) return;
    const base = cont.getBoundingClientRect();
    const card = document.getElementById('tr-' + desdeId);
    const rc = card?.getBoundingClientRect();
    const borde = rc ? (lado === 'izq' ? rc.left : rc.right) : e.clientX;
    const alto = rc ? (lado === 'izq' ? rc.top + rc.height * 0.72 : rc.top + rc.height / 2) : e.clientY;
    setCable({
      desde: desdeId,
      x1: borde - base.left + cont.scrollLeft,
      y1: alto - base.top + cont.scrollTop,
      x: e.clientX - base.left + cont.scrollLeft,
      y: e.clientY - base.top + cont.scrollTop
    });
  }

  useEffect(() => {
    if (!cable) return;
    const cont = flowRef.current;
    const mover = (e) => {
      if (!cont) return;
      const base = cont.getBoundingClientRect();
      setCable(c => c && ({
        ...c,
        x: e.clientX - base.left + cont.scrollLeft,
        y: e.clientY - base.top + cont.scrollTop
      }));
    };
    const soltar = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const card = el && el.closest ? el.closest('.tf-card') : null;
      if (card) {
        const destino = Number(card.id.replace('tr-', ''));
        if (destino && destino !== cable.desde) intentarConectar(destino, cable.desde);
      } else {
        setAvisoEditor('Soltaste fuera de una tarjeta: la conexión no se creó.');
      }
      setCable(null);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    return () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
    };
  }, [cable]);

  // ---- render ----
  function Tile({ m, conPosicion, forzar }) {
    let est = estadoDe(m);
    if (forzar === 'run' && est.tipo === 'cascada') {
      est = { tipo: 'run' };
    } else if (forzar && forzar !== 'run' && est.tipo === 'run') {
      est = { tipo: 'cascada', propia: false, p: { causa: '', origen: forzar } };
    }
    const texto = est.tipo === 'run'
      ? '▶ Operando'
      : est.tipo === 'cascada'
        ? `↯ Detenida por ${est.p.origen}`
        : `■ ${est.p.causa} · ${minutos(est.p.hora_inicio, ahora)}`;
    return (
      <button className={`tile ${est.tipo}`} onClick={() => tocar(m, est)}>
        {conPosicion && m.posicion && <span className="code">Etapa {m.posicion}</span>}
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
            <span>
              {cat?.turno ? `${cat.turno.nombre} · ${cat.turno.supervisor}` : 'Sin turno activo'}
              {cat?.turno?.cerrado ? ' · CERRADO' : ''}
              {lineasSel.length ? ` · ${lineasSel.length} ${lineasSel.length === 1 ? 'línea' : 'líneas'}` : ''}
            </span>
          </div>
        </div>

        <div className="hint"><kbd>1</kbd> máquina <b>·</b> <kbd>2</kbd> causa</div>

        <div className={`net ${online && !sinRed ? '' : 'off'}`}>
          <i /> <span>{online && !sinRed ? 'En línea' : 'Sin enlace'}</span>
          <span className="dim">|</span>
          <span>{pend === 0 ? 'sin pendientes' : `${pend} ${pend === 1 ? 'pendiente' : 'pendientes'}`}</span>
        </div>

        <button className="gear" onClick={() => setAnalisis(true)} title="Análisis de paradas" aria-label="Análisis">
          <svg viewBox="0 0 24 24"><path d="M4 20V11M9.5 20V5M15 20v-6M20.5 20V8" /></svg>
        </button>
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
      {error && (
        <div className="aviso error">
          <span>{error}</span>
          {conflictoEquipos.length > 0 && (
            <button className="aviso-btn"
                    onClick={() => abrirLineaRapida(conflictoEquipos)}>
              Armar una línea nueva con esos equipos
            </button>
          )}
        </div>
      )}

      <div className="layout">
        <aside className="side">
          <div className="proceso-box">
            <div className="side-h">Proceso del turno</div>

            <button className={`lineas-sel ${lineasAbierto ? 'abierto' : ''}`}
                    onClick={() => setLineasAbierto(v => !v)} aria-expanded={lineasAbierto}>
              <span>
                <b>Cambiar líneas del turno</b>
                <small>
                  {lineasSel.length
                    ? `${lineasSel.length} de ${lineas.length} ${lineas.length === 1 ? 'línea' : 'líneas'}`
                    : 'Ninguna marcada'}
                </small>
              </span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9.5 6 6 6-6" /></svg>
            </button>

            <button className="btn-linea-nueva"
                    onClick={() => abrirLineaRapida([])}>
              ＋ Armar línea nueva
            </button>

            {lineasAbierto && (
              <div className="lineas-lista">
                {lineas.map(l => {
                  const dentro = lineasSel.includes(l.linea_id);
                  return (
                    <div key={l.linea_id} className={`lineas-op ${dentro ? 'on' : ''}`}>
                      <button className="lineas-toggle" aria-pressed={dentro}
                              onClick={() => toggleLinea(l.linea_id)}>
                        <span className={`line-check ${dentro ? 'on' : ''}`} aria-hidden="true">
                          {dentro ? '✓' : ''}
                        </span>
                        <b>{l.nombre}</b>
                      </button>
                      <button className="lineas-abrir" aria-label={`Ver ${l.nombre}`}
                              onClick={() => { setSel(l.linea_id); setLineasAbierto(false); }}>
                        ›
                      </button>
                    </div>
                  );
                })}
                {!lineas.length && <div className="armado-vacio">No hay líneas cargadas</div>}
                {procesoId && (
                  <button className="lineas-ver"
                          onClick={() => { setSel(procesoId ? 'p:' + procesoId : 'todas'); setLineasAbierto(false); }}>
                    Ver el tablero en vivo
                  </button>
                )}
              </div>
            )}

            <button className="btn-guardar-proc ancho" onClick={guardarProcesoTurno}
                    disabled={!lineasSel.length || !cambiosPendientes}>
              {cambiosPendientes ? 'Guardar cambios' : 'Guardado'}
            </button>
          </div>

          {/* Las líneas ya guardadas en el turno: se toca una y se registran las fallas ahí */}
          {lineasTurno.length > 0 && (
            <>
              <div className="side-h">Líneas del turno</div>
              {lineasTurno.map(l => {
                const st = estadoLinea(l);
                return (
                  <button key={l.linea_id} className={`line-item compacto ${sel === l.linea_id ? 'on' : ''}`}
                          onClick={() => { setSel(l.linea_id); refrescar(); }}>
                    <span className="lname">
                      <b>{l.nombre}</b>
                      <small>
                        {l.maquinas} máquinas · {st.estado === 'operando' ? 'operando' : st.causa}
                      </small>
                    </span>
                    <span className={`pill ${st.estado}`}>
                      {st.estado === 'operando' ? 'OK' : st.estado === 'detenida' ? 'PARADA' : 'PARCIAL'}
                    </span>
                  </button>
                );
              })}
            </>
          )}

          {/* Líneas ya armadas que esperan su turno: activarlas saca del turno a la
              que está usando esos mismos equipos. */}
          {lineasListas.length > 0 && (
            <>
              <div className="side-h">Líneas listas para activar</div>
              {lineasListas.map(l => {
                const choca = conQueChoca(l.linea_id);
                const equipos = (trama || []).filter(t => t.linea_id === l.linea_id).length;
                return (
                  <div className="linea-lista" key={l.linea_id}>
                    <div className="ll-txt">
                      <b>{l.nombre}</b>
                      <small>
                        {equipos} equipos
                        {choca.length > 0 ? ` · reemplaza a ${choca.join(', ')}` : ' · no choca con el turno'}
                      </small>
                    </div>
                    <button className="ll-btn" onClick={() => activarLinea(l.linea_id)}>Activar</button>
                  </div>
                );
              })}
            </>
          )}

          {lineaActual && (
            <button className="btn-edit" onClick={() => abrirEditor()}>
              <svg viewBox="0 0 24 24">
                <path d="M4 20h4.5L19 9.5 14.5 5 4 15.5V20Z" />
                <path d="m13.5 6 4.5 4.5" />
              </svg>
              Editar trama
            </button>
          )}

          <div className="side-foot">
            <span>{totalDetenidas} máquinas detenidas</span>
            <span>{nf.format(maqsVisibles.length)} en el turno</span>
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

                {(() => {
                  const t = tiempoLinea(lineaActual);
                  if (!t) return null;
                  return (
                    <span className="ln-tiempos">
                      <b>{fmtMin(t.trabajo)} de trabajo</b>
                      <em>{fmtMin(t.total)} desde el corte · {fmtMin(t.parada)} en parada</em>
                    </span>
                  );
                })()}

                <div className="ln-acciones">
                  <button className="btn-detener-proceso" onClick={detenerProceso}
                          title="Registra una parada sobre el cuello de la línea: se detiene todo el proceso">
                    ■ Detener el proceso
                  </button>
                  <button className="btn-fin-turno" onClick={() => setConfirmarCierre(true)}
                          title="Fine de turno: detiene las líneas armadas con la causa «Fin de turno» y cierra el proceso">
                    ⏹ Fin de turno
                  </button>
                  {procesoId && (
                    <button className="volver-planta" onClick={() => setSel('p:' + procesoId)}>
                      ← Tablero en vivo
                    </button>
                  )}
                </div>
              </div>
              <div className="flow split">
                {columnasLinea.map((col, ci) => (
                  <div className={`flow-col ${col.filas.length > 1 ? 'multi' : ''}`} key={col.pos}>
                    <span className="flow-etapa">Etapa {col.pos}</span>
                    <div className="flow-stack">
                      {col.filas.map(m => {
                        const base = estadoDe(m).tipo;
                        const forzar = afectadasLinea.has(m.id)
                          ? afectadasLinea.get(m.id)
                          : (base === 'cascada' ? 'run' : undefined);
                        return <Tile key={m.id} m={m} forzar={forzar} />;
                      })}
                    </div>
                    {ci < columnasLinea.length - 1 && <span className="arrow">→</span>}
                  </div>
                ))}
              </div>
              <p className="flow-hint">
                El orden es el flujo real: si se detiene una máquina marcada como cuello, la línea completa se detiene;
                si no, se detiene lo que viene aguas abajo.
              </p>
            </>
          ) : (
            <div className="monitor">
              <div className="mon-top">
                <div>
                  <b>{cat?.turno ? `Turno ${cat.turno.nombre}` : 'Sin turno activo'}</b>
                  <span>
                    {cat?.turno?.supervisor || 'Sin supervisor'}
                    {' · '}{lineasTurno.length} {lineasTurno.length === 1 ? 'línea' : 'líneas'}
                    {' · '}{nf.format(maqsVisibles.length)} máquinas
                  </span>
                </div>
                <div className="mon-envivo"><i /> En vivo</div>
              </div>

              <div className="mon-ahora">
                {filasMonitor.map(f => (
                  <div key={f.id} className={`mon-fila ${f.estado}`}>
                    <span className="mon-nombre">{f.nombre}</span>
                    <span className="mon-pista"><i /></span>
                    <span className="mon-estado">
                      <b>{f.estado === 'operando' ? 'Operando' : f.estado === 'detenida' ? 'Parada total' : 'Parada parcial'}</b>
                      <small>
                        {f.estado === 'operando'
                          ? `${f.maquinas} máquinas · ${fmtMin(f.trabajo || 0)} de trabajo`
                          : `${f.causa}${f.origen ? ` · ${f.origen}` : ''} · ${f.tiempo}`}
                      </small>
                    </span>
                  </div>
                ))}
                {!filasMonitor.length && (
                  <div className="mon-vacio">No hay líneas en el turno. Elegilas en el panel de la izquierda.</div>
                )}
              </div>

              <div className="mon-perdidas">
                <div className="mon-card mon-total">
                  <span>Tiempo perdido</span>
                  <b>{fmtMin(perdidas.total)}</b>
                  <small>
                    {perdidas.n} {perdidas.n === 1 ? 'parada' : 'paradas'}
                    {perdidas.abiertas ? ` · ${perdidas.abiertas} en curso` : ''}
                  </small>
                </div>

                <div className="mon-card">
                  <span>Por línea</span>
                  {perdidas.porLinea.map(x => (
                    <div className="mon-bar" key={x.key}>
                      <b>{x.nombre}</b>
                      <span className="mon-bar-pista"><i style={{ width: `${x.pct}%` }} /></span>
                      <em>{fmtMin(x.min)}</em>
                    </div>
                  ))}
                  {!perdidas.porLinea.length && <small className="mon-vacio">Sin paradas en el turno</small>}
                </div>

                <div className="mon-card">
                  <span>Por causa</span>
                  {perdidas.porCausa.map(x => (
                    <div className="mon-bar" key={x.key}>
                      <b>{x.nombre}</b>
                      <span className="mon-bar-pista causa"><i style={{ width: `${x.pct}%` }} /></span>
                      <em>{fmtMin(x.min)}</em>
                    </div>
                  ))}
                  {!perdidas.porCausa.length && <small className="mon-vacio">Sin paradas en el turno</small>}
                </div>
              </div>

              {(monitor?.cortes || []).length > 0 && (
                <div className="mon-card mon-cortes">
                  <span>Cortes del proceso</span>
                  {monitor.cortes.map(c => (
                    <div className={`mon-corte ${c.hasta ? '' : 'abierto'}`} key={c.id}>
                      <span className="mc-horas">
                        {hhmm(c.desde)} – {c.hasta ? hhmm(c.hasta) : 'ahora'}
                      </span>
                      <span className="mc-lineas">
                        {(c.lineas || []).map(l => l.nombre).join('  +  ') || 'sin proceso'}
                      </span>
                      <span className="mc-min">
                        {fmtMin(c.minutos)}{c.hasta ? '' : ' · en curso'}
                      </span>
                      <span className="mc-perd">
                        {c.perdidos > 0 ? `${fmtMin(c.perdidos)} perdidos` : 'sin paradas'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="mon-pie">
                Actualizado {monitor?.ahora
                  ? new Date(monitor.ahora).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
                  : '—'}
                {' · '}sólo lectura
              </div>
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
                {(causasPorMaquina.get(sheet.maquina.id)?.size || 0) > 0
                  ? ' · fallas de este equipo' : ''}
              </div>
            </div>
            <button className="x" onClick={() => setSheet(null)}>✕</button>
          </div>
          <div className="cats">
            {cat.categorias.map(c => {
              const n = causasVisibles(sheet.maquina.id, c.id, false).length;
              if (!n) return null;
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
              <div className="sub">
                {sheet.maquina.nombre} · elige la causa
                {(causasPorMaquina.get(sheet.maquina.id)?.size || 0) > 0 && (
                  <button className="link" onClick={() => setSheet({ ...sheet, todas: !sheet.todas })}>
                    {sheet.todas ? ' · ver solo las de este equipo' : ' · ver todas las fallas'}
                  </button>
                )}
              </div>
            </div>
            <button className="x" onClick={() => setSheet(null)}>✕</button>
          </div>
          <div className="causes">
            {causasVisibles(sheet.maquina.id, sheet.categoria.id, sheet.todas).map((c, i) => (
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

      {/* Aviso de fin de turno */}
      {confirmarCierre && (
        <div className="confirma-capa" onClick={() => setConfirmarCierre(false)}>
          <div className="confirma" onClick={e => e.stopPropagation()}>
            <h3>¿Cerrar el turno?</h3>
            <p>
              Se registra la parada <b>Fin de turno</b> en las líneas armadas que estén operando
              (no cuenta como tiempo perdido), se cierra el corte de proceso y el turno queda cerrado.
            </p>
            <p className="confirma-nota">
              Después se elige el armado del turno siguiente como siempre.
            </p>
            <div className="confirma-acciones">
              <button className="ghost" onClick={() => setConfirmarCierre(false)}>Cancelar</button>
              <button className="btn-go small" onClick={cerrarTurno}>Sí, cerrar el turno</button>
            </div>
          </div>
        </div>
      )}

      {/* Aviso antes de sacar del turno una línea que tiene equipos en funcionamiento */}
      {confirmarActivacion && (
        <div className="confirma-capa" onClick={() => setConfirmarActivacion(null)}>
          <div className="confirma" onClick={e => e.stopPropagation()}>
            <h3>Activar {confirmarActivacion.nombre}</h3>
            <p>
              Para activarla tienen que salir del turno las líneas que están usando esos mismos equipos:
            </p>
            <ul className="confirma-lista">
              {confirmarActivacion.salen.map(s => (
                <li key={s.id}>
                  <b>{s.nombre}</b>
                  <small>
                    {s.detenidas > 0
                      ? `${s.detenidas} equipo${s.detenidas === 1 ? '' : 's'} en parada ahora`
                      : 'operando, sin paradas'}
                  </small>
                </li>
              ))}
            </ul>
            <p className="confirma-nota">
              Su proceso se cierra en este momento y queda registrado el corte de hora.
            </p>
            <div className="confirma-acciones">
              <button className="ghost" onClick={() => setConfirmarActivacion(null)}>Cancelar</button>
              <button className="btn-go small" onClick={confirmarActivacionYGuardar}>
                Activar y cerrar {confirmarActivacion.salen.length === 1 ? 'esa línea' : 'esas líneas'}
              </button>
            </div>
          </div>
        </div>
      )}

      {analisis && <Analisis onClose={() => setAnalisis(false)} />}

      {lineaRapida && (
        <LineaRapida
          areas={cat?.areas || []}
          maquinas={maqs}
          trama={trama}
          lineas={lineas}
          armadas={idsTurno}
          inicial={lineaRapida.equipos || []}
          especies={lineaRapida.especies || []}
          productos={lineaRapida.productos || []}
          onClose={() => setLineaRapida(null)}
          onCrear={crearLineaDesdeTablero}
        />
      )}

      {editor && (
        <div className="sheet">
          <div className="top">
            <div>
              <h3>Trama · {editor.linea.nombre}</h3>
              <div className="sub">
                Arrastrá las tarjetas para cambiar de etapa o de rama. Solo un cuello de botella,
                y ese detiene la línea completa.
              </div>
            </div>
            <button className="x" onClick={() => setEditor(null)}>✕</button>
          </div>

          <div className="tf-body">
            {modoConexion && (
              <div className="tf-avisos modo">
                <b>Conectando desde {nombreCorto(modoConexion)}</b>
                <span>Tocá la tarjeta que debe recibir de este bloque (o arrastrá desde un punto de salida).</span>
              </div>
            )}
            {(avisos.length > 0 || avisoEditor) && (
              <div className="tf-avisos">
                {avisos.length > 0 && (
                  <>
                    <b>{avisos.length} bloque(s) con la conexión incompleta</b>
                    <span>{avisos.map(a => a.texto).join(' · ')}</span>
                  </>
                )}
                {avisoEditor && <span className="tf-aviso-mov">{avisoEditor}</span>}
              </div>
            )}
            <div className="tf-zoom-wrap"
                 style={{ width: lienzo.w * zoom, height: lienzo.h * zoom }}>
            <div className="tf-canvas" ref={flowRef}
                 style={{
                   width: lienzo.w, height: lienzo.h,
                   transform: `scale(${zoom})`, transformOrigin: '0 0'
                 }}>
              <svg className="tf-links" width={dims.w} height={dims.h}
                   viewBox={`0 0 ${Math.max(dims.w, 1)} ${Math.max(dims.h, 1)}`}>
                {links.map(l => {
                  const m = maqs.find(x => x.id === l.desde);
                  const enMarcha = m ? estadoDe(m).tipo === 'run' : false;
                  return (
                    <g key={l.k}>
                      <path d={l.d} fill="none" stroke={l.color} strokeWidth="2.4" opacity=".25" />
                      <path d={l.d} fill="none" stroke={l.color} strokeWidth="2.4"
                            className={`tf-link ${enMarcha ? 'flujo' : 'detenido'}`} />
                      {enMarcha && (
                        <circle r="3.6" fill={l.color} opacity=".95">
                          <animateMotion dur="2.6s" repeatCount="indefinite" path={l.d} />
                        </circle>
                      )}
                      <circle cx={l.x2} cy={l.y2} r="4.5" fill={l.color} />
                      <circle cx={l.x1} cy={l.y1} r="3" fill={l.color} opacity=".9" />
                    </g>
                  );
                })}
                {cable && (
                  <path d={`M ${cable.x1} ${cable.y1} C ${cable.x1 + 50} ${cable.y1}, ${cable.x - 50} ${cable.y}, ${cable.x} ${cable.y}`}
                        fill="none" stroke="#7FB3D9" strokeWidth="2" strokeDasharray="5 4" opacity=".8" />
                )}
              </svg>

              {guias.map(g => (
                <div className="tf-guia" key={g.n} style={{ left: g.x - 14 }}>
                  <span className="tf-guia-h">Etapa {g.n}</span>
                </div>
              ))}

              {editor.filas.map(f => {
                const salientes = conexionesSalidaDe(f.maquina_id).length > 0;
                const entrantes = entradasDe(f.maquina_id).length > 0;
                return (
                  <div key={f.maquina_id} id={'tr-' + f.maquina_id}
                       className={`tf-card ${f.detiene_linea ? 'is-cuello' : ''}
                                   ${f.fin_linea ? 'is-fin' : ''}
                                   ${seleccionada === f.maquina_id ? 'sel' : ''}
                                   ${(!salientes && !entrantes && editor.filas.length > 1) ? 'sin-conexion' : ''}
                                   ${moviendo === f.maquina_id ? 'dragging' : ''}`}
                       style={{
                         left: f.x, top: f.y,
                         borderColor: salientes ? colorFuente(f.maquina_id) : undefined,
                         boxShadow: salientes
                           ? `0 0 0 1px ${colorFuente(f.maquina_id)}33, 0 8px 20px -14px rgba(15,27,39,.5)`
                           : undefined
                       }}
                       onPointerDown={e => iniciarMover(e, f)}
                       onClick={() => {
                         if (modoConexion && modoConexion !== f.maquina_id) {
                           intentarConectar(f.maquina_id, modoConexion);
                           setModoConexion(null);
                         } else {
                           setSeleccionada(f.maquina_id);
                         }
                       }}>
                      <span className="tf-port in" title="Entrada" />
                      <span className={`tf-port out izq ${conexionesSalidaDe(f.maquina_id).length ? 'activo' : ''}`}
                            title="Arrastrá para conectar hacia atrás"
                            style={conexionesSalidaDe(f.maquina_id).length
                              ? { borderColor: colorFuente(f.maquina_id), background: colorFuente(f.maquina_id) }
                              : undefined}
                            onPointerDown={e => iniciarCable(e, f.maquina_id, 'izq')}
                            onClick={() => setModoConexion(f.maquina_id)} />
                      <span className={`tf-port out ${conexionesSalidaDe(f.maquina_id).length ? 'activo' : ''}`}
                            title="Arrastrá para conectar"
                            style={conexionesSalidaDe(f.maquina_id).length
                              ? { borderColor: colorFuente(f.maquina_id), background: colorFuente(f.maquina_id) }
                              : undefined}
                            onPointerDown={e => iniciarCable(e, f.maquina_id)}
                            onClick={() => setModoConexion(f.maquina_id)} />

                      <div className="tf-head">
                        <span className="tf-etapa">Rama {f.rama}</span>
                        {f.detiene_linea && <span className="tf-tag">cuello</span>}
                        {f.fin_linea && <span className="tf-tag fin">fin</span>}
                        {avisos.some(a => a.id === f.maquina_id) && (
                          <span className="tf-warn" title="Conexión incompleta">!</span>
                        )}
                      </div>

                      <b className="tf-name">{f.nombre_corto}</b>
                      <span className="tf-area">{f.area}</span>

                      <div className="tf-padre">
                        <span className="tf-padre-h">Entradas</span>
                        <div className="tf-chips">
                          {entradasDe(f.maquina_id).length === 0 && (
                            <span className="tf-chip empty">inicio de línea</span>
                          )}
                          {entradasDe(f.maquina_id).map(p => (
                            <span className="tf-chip" key={p}>
                              {nombreCorto(p)}
                              <button onClick={() => setEntrada(f.maquina_id, p, false)} title="Quitar entrada">✕</button>
                            </span>
                          ))}
                        </div>
                        <select value=""
                                onChange={e => {
                                  if (e.target.value) intentarConectar(f.maquina_id, Number(e.target.value));
                                  e.currentTarget.value = '';
                                }}>
                          <option value="">＋ conectar entrada…</option>
                          {editor.filas
                            .filter(x => x.maquina_id !== f.maquina_id)
                            .map(x => <option key={x.maquina_id} value={x.maquina_id}>{x.nombre_corto}</option>)}
                        </select>
                      </div>

                      <label className="tf-cuello">
                        <input type="radio" name="cuello" checked={f.detiene_linea}
                               onChange={() => marcarCuello(f.maquina_id)} />
                        cuello de línea
                      </label>
                      <label className="tf-cuello tf-fin">
                        <input type="checkbox" checked={f.fin_linea}
                               onChange={() => alternarFin(f.maquina_id)} />
                        fin de línea
                      </label>

                      <label className="tf-mover">
                        <span>Pasar a otra línea</span>
                        <select value=""
                                onChange={e => {
                                  if (e.target.value) moverEquipo(f.maquina_id, Number(e.target.value));
                                  e.currentTarget.value = '';
                                }}>
                          <option value="">Elegir línea…</option>
                          {lineas
                            .filter(l => l.linea_id !== editor.linea.linea_id)
                            .map(l => <option key={l.linea_id} value={l.linea_id}>{l.nombre}</option>)}
                        </select>
                      </label>

                      {/* sugerencias para enlazar sin buscar en los desplegables */}
                      {seleccionada === f.maquina_id &&
                        (sugerencias.entrada.length > 0 || sugerencias.salida.length > 0) && (
                        <div className="tf-sug">
                          <span className="tf-sug-h">Sugerencias de conexión</span>
                          <div className="tf-sug-chips">
                            {sugerencias.entrada.map(x => (
                              <button key={'e' + x.maquina_id} className="tf-sug-chip"
                                      title={`Conectar la entrada desde ${x.nombre_corto}`}
                                      onClick={() => intentarConectar(f.maquina_id, x.maquina_id)}>
                                ← {x.nombre_corto}
                              </button>
                            ))}
                            {sugerencias.salida.map(x => (
                              <button key={'s' + x.maquina_id} className="tf-sug-chip out"
                                      title={`Conectar la salida hacia ${x.nombre_corto}`}
                                      onClick={() => intentarConectar(x.maquina_id, f.maquina_id)}>
                                {x.nombre_corto} →
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="tf-actions">
                        <button className="danger" onClick={() => quitar(f.maquina_id)} title="Quitar">✕</button>
                      </div>
                  </div>
                );
              })}
            </div>
            </div>

          <div className="add-row">
            <button className="btn-agregar-tarjeta"
                    onClick={() => { setPicker(v => !v); setPickerBuscar(''); }}>
              ＋ Agregar tarjeta
            </button>
            <button className="btn-acomodar" title="Separa las tarjetas que se pisan"
                    onClick={() => editar(filas => acomodar(filas))}>Acomodar</button>
          </div>

          {picker && (
            <div className="tf-picker">
              <div className="tf-picker-top">
                <b>Agregar tarjeta</b>
                <input placeholder="Buscar equipo…" value={pickerBuscar} autoFocus
                       onChange={e => setPickerBuscar(e.target.value)} />
                <button className="x" onClick={() => setPicker(false)} aria-label="Cerrar">✕</button>
              </div>
              <div className="tf-picker-lista">
                {disponiblesPick.map(m => {
                  const otras = lineasDeMaquina(m.id);
                  const ocupada = otras.some(o => o.armada);
                  return (
                    <button key={m.id} className="tf-picker-item" onClick={() => agregarMaquina(m.id)}>
                      <span className="tf-picker-nombre">
                        <b>{m.nombre_corto}</b>
                        <small>{m.area}</small>
                      </span>
                      {otras.length > 0 && (
                        <em className={ocupada ? 'ocupada' : ''}>
                          {ocupada ? 'en el turno: ' : 'también en '}
                          {otras.map(o => o.nombre).join(', ')}
                        </em>
                      )}
                    </button>
                  );
                })}
                {!disponiblesPick.length && (
                  <div className="tf-picker-vacio">No hay equipos para agregar</div>
                )}
              </div>
              <div className="tf-picker-foot">
                <span>{editor.filas.length} en la trama</span>
                <button className="btn-go small" onClick={() => setPicker(false)}>Listo</button>
              </div>
            </div>
          )}
          </div>

          <div className="editor-foot">
            <span className="err">{editor.error || ''}</span>
            <div className="tf-zoom">
              <button onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(2)))} title="Alejar">−</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(1.6, +(z + 0.1).toFixed(2)))} title="Acercar">＋</button>
            </div>
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
