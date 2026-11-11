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
  const [conexiones, setConexiones] = useState([]);
  const [procesos, setProcesos] = useState([]);
  const [proceso, setProceso] = useState(null);
  const [sel, setSel] = useState('todas');

  const [locales, setLocales] = useState({});   // maquina_id -> parada local
  const [cerradas, setCerradas] = useState([]); // uuids cerrados en esta sesión

  const [ajustes, setAjustes] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [editor, setEditor] = useState(null);
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
    } catch { /* sin red: se mantiene lo que hay */ }
  }

  useEffect(() => {
    const id = typeof sel === 'string' && sel.startsWith('p:') ? Number(sel.slice(2)) : null;
    if (!id) { setProceso(null); return; }
    let vivo = true;
    api.proceso(id).then(p => { if (vivo) setProceso(p); }).catch(() => {});
    return () => { vivo = false; };
  }, [sel]);

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
    // solo las áreas con equipos: una planta con 6 áreas y 2 máquinas no debe
    // mostrar cuatro columnas vacías
    return cat.areas
      .map(a => ({ ...a, maquinas: maqs.filter(m => m.area_id === a.id) }))
      .filter(a => a.maquinas.length > 0);
  }, [cat, maqs]);

  const lineaActual = (sel === 'todas' || String(sel).startsWith('p:'))
    ? null
    : lineas.find(l => l.linea_id === sel);

  // etapas agrupadas: las «en paralelo» comparten el paso
  const etapasAgrupadas = useMemo(() => {
    if (!proceso) return [];
    const grupos = [];
    for (const e of proceso.etapas) {
      const ultimo = grupos[grupos.length - 1];
      if (e.paralelo && ultimo) ultimo.etapas.push(e);
      else grupos.push({ orden: e.orden, etapas: [e] });
    }
    return grupos;
  }, [proceso]);

  const maquinasLinea = useMemo(() => {
    if (!lineaActual) return [];
    return trama
      .filter(t => t.linea_id === lineaActual.linea_id)
      .sort((a, b) => a.posicion - b.posicion)
      .map(t => {
        const m = maqs.find(x => x.id === t.maquina_id);
        return m ? { ...m, posicion: t.posicion, rama: t.rama || 1 } : null;
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
    for (const m of maquinasLinea) {
      const e = estadoDe(m);
      if (e.tipo === 'stop' || e.tipo === 'plan') {
        propias.add(m.id);
        if (e.p.alcance === 'linea') alcanceLinea = true;
      }
    }
    const stop = new Set(propias);
    if (alcanceLinea) {
      for (const m of maquinasLinea) stop.add(m.id);
    } else {
      const edges = (conexiones || []).filter(c => c.linea_id === lineaActual.linea_id);
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
    for (const m of maquinasLinea) {
      if (stop.has(m.id) && !propias.has(m.id)) {
        const origen = (conexiones || [])
          .filter(c => c.hasta_maquina_id === m.id)
          .map(c => maquinasLinea.find(x => x.id === c.desde_maquina_id)?.nombre_corto)
          .filter(Boolean)[0];
        mapa.set(m.id, origen || 'otra etapa');
      }
    }
    return mapa;
  }, [lineaActual, maquinasLinea, conexiones, locales, cerradas]);


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

  const entradasDe = (id) => (editor?.conexiones || [])
    .filter(c => c.hasta_maquina_id === id)
    .map(c => c.desde_maquina_id);
  const nombreCorto = (id) => editor?.filas.find(f => f.maquina_id === id)?.nombre_corto || '?';

  // Cada equipo cae en una columna segun cuantos saltos lo separan del inicio
  // (siguiendo las conexiones «entra de»).
  function conNiveles(filas, cons) {
    const porId = new Map(filas.map(f => [f.maquina_id, f]));
    // Línea sin conexiones todavía: se mantiene el orden guardado
    if (!cons || cons.length === 0) {
      return filas.map(f => ({ ...f, posicion: f.posicion || 1, rama: f.rama || 1 }));
    }
    const entradas = new Map();
    for (const c of (cons || [])) {
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
    const filas = conNiveles(editor.filas, editor.conexiones);
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
  function abrirEditor(lineaParam) {
    const linea = lineaParam || lineaActual;
    if (!linea) return;
    const lineaId = linea.linea_id ?? linea.id;
    const filas = trama
      .filter(t => t.linea_id === lineaId)
      .sort((a, b) => a.posicion - b.posicion)
      .map(t => ({
        maquina_id: t.maquina_id, nombre_corto: t.nombre_corto,
        area: t.area, detiene_linea: t.detiene_linea,
        posicion: t.posicion, rama: t.rama || 1
      }));
    const cons = (conexiones || [])
      .filter(c => c.linea_id === lineaId)
      .map(c => ({ desde_maquina_id: c.desde_maquina_id, hasta_maquina_id: c.hasta_maquina_id }));
    setEditor({ linea: { ...linea, linea_id: lineaId }, filas, conexiones: cons,
                nueva: '', error: null, guardando: false });
  }

  function editar(fn) {
    setEditor(prev => {
      const e = { ...prev, filas: fn(prev.filas) };
      return e;
    });
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
  function soltarEnCard(dragId, destinoId) {
    if (!dragId || dragId === destinoId) return;
    setEntrada(dragId, destinoId, true);   // la arrastrada recibe de la destino
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

  function setEntrada(maquinaId, desdeId, agregar) {
    if (!editor || !desdeId) return;
    if (agregar && desdeId === maquinaId) return;
    setEditor(prev => {
      let cons = [...(prev.conexiones || [])];
      if (agregar) {
        // evitar ciclos: desdeId no puede colgar de maquinaId
        const alcanza = (origen, destino, visto = new Set()) => {
          if (origen === destino) return true;
          if (visto.has(origen)) return false;
          visto.add(origen);
          return cons.filter(c => c.desde_maquina_id === origen)
                      .some(c => alcanza(c.hasta_maquina_id, destino, visto));
        };
        if (alcanza(maquinaId, desdeId)) return prev;
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

  function agregarMaquina() {
    const id = Number(editor.nueva);
    if (!id) return;
    const m = maqs.find(x => x.id === id);
    if (!m) return;
    const max = editor.filas.length ? Math.max(...editor.filas.map(f => f.posicion)) : 0;
    editar(filas => renum([...filas, {
      maquina_id: m.id, nombre_corto: m.nombre_corto, area: m.area,
      detiene_linea: false, posicion: max + 1, rama: 1
    }]));
    setEditor(prev => ({ ...prev, nueva: '' }));
  }

  async function guardarTrama() {
    setEditor(prev => ({ ...prev, guardando: true, error: null }));
    try {
      const orden = conNiveles(editor.filas, editor.conexiones);
      await api.guardarTrama(editor.linea.linea_id,
        orden.map(f => ({
          maquina_id: f.maquina_id, detiene_linea: f.detiene_linea,
          posicion: f.posicion, rama: f.rama
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
                <span className="line-badge">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 7h16M4 12h16M4 17h10" />
                  </svg>
                </span>
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

          {procesos.length > 0 && (
            <>
              <div className="side-h">Procesos</div>
              {procesos.map(p => (
                <button key={p.id} className={`line-item ${sel === 'p:' + p.id ? 'on' : ''}`}
                        onClick={() => setSel('p:' + p.id)}>
                  <span className="line-badge">
                    <svg viewBox="0 0 24 24">
                      <rect x="2.5" y="4" width="6" height="5" rx="1.4" />
                      <rect x="15.5" y="4" width="6" height="5" rx="1.4" />
                      <rect x="9" y="15" width="6" height="5" rx="1.4" />
                      <path d="M8.5 6.5h7M12 9v6" />
                    </svg>
                  </span>
                  <span className="lname">
                    <b>{p.nombre}</b>
                    <small>{[p.especie, p.producto].filter(Boolean).join(' · ') || 'proceso'} · {p.etapas} etapas</small>
                  </span>
                  <span className="pill">{p.etapas}</span>
                </button>
              ))}
            </>
          )}

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

          {proceso ? (
            <>
              <div className="line-head">
                <b>{proceso.receta.nombre}</b>
                <span>
                  {[proceso.receta.especie, proceso.receta.producto].filter(Boolean).join(' · ')}
                  {' · '}{proceso.etapas.length} etapas
                  {proceso.receta.toneladas_turno ? ` · ${Number(proceso.receta.toneladas_turno)} t/turno` : ''}
                </span>
              </div>
              <div className="proc-flow">
                {etapasAgrupadas.map((g, gi) => (
                  <div className="proc-step" key={g.orden}>
                    <div className="proc-num">{g.orden}</div>
                    <div className="proc-cards">
                      {g.etapas.map(e => (
                        <div className="proc-card" key={e.id}>
                          <div className="proc-h">
                            <b>{e.nombre}</b>
                            <span>{e.tipo === 'linea' ? 'línea completa' : 'máquina'}</span>
                          </div>
                          <div className="proc-maquinas">
                            {e.maquinas.map(mm => {
                              const m = maqs.find(x => x.id === mm.id);
                              return m ? <Tile key={m.id} m={m} /> : null;
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    {gi < etapasAgrupadas.length - 1 && <span className="proc-arrow">→</span>}
                  </div>
                ))}
              </div>
              <p className="flow-hint">
                Proceso seleccionado: tocá cualquier máquina para registrar la parada. Los equipos vienen
                de las líneas y máquinas que armaste en la receta.
              </p>
            </>
          ) : lineaActual ? (
            <>
              <div className={`line-head ${estadoLinea(lineaActual).estado}`}>
                <b>{lineaActual.nombre}</b>
                <span>
                  {estadoLinea(lineaActual).estado === 'operando'
                    ? 'Línea operando'
                    : `${estadoLinea(lineaActual).estado === 'detenida' ? 'Parada total' : 'Parada parcial'} · ${estadoLinea(lineaActual).causa} · desde ${estadoLinea(lineaActual).origen}`}
                </span>
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
          <div className="trama-flow">
            {columnasEditor.map((col, ci) => (
              <div className={`tf-col ${col.filas.length > 1 ? 'multi' : ''}`} key={col.pos}>
                <span className="tf-etapa-h">Etapa {col.pos}</span>

                <div className="tf-stack">
                  {col.filas.map(f => (
                    <div className={`tf-card ${f.detiene_linea ? 'is-cuello' : ''}
                                     ${arrastre === f.maquina_id ? 'dragging' : ''}
                                     ${sobre === 'card:' + f.maquina_id ? 'drop-target' : ''}`}
                         key={f.maquina_id} id={'tr-' + f.maquina_id}
                         draggable
                         onDragStart={e => {
                           e.dataTransfer.effectAllowed = 'move';
                           e.dataTransfer.setData('text/plain', String(f.maquina_id));
                           setArrastre(f.maquina_id);
                         }}
                         onDragEnd={() => { setArrastre(null); setSobre(null); }}
                         onDragOver={e => { e.preventDefault(); setSobre('card:' + f.maquina_id); }}
                         onDrop={e => {
                           e.preventDefault();
                           e.stopPropagation();
                           const id = Number(e.dataTransfer.getData('text/plain'));
                           const r = e.currentTarget.getBoundingClientRect();
                           soltarEnCard(id, f.maquina_id);
                         }}>
                      <div className="tf-head">
                        <span className="tf-etapa">Rama {f.rama}</span>
                        {f.detiene_linea && <span className="tf-tag">cuello</span>}
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
                                  if (e.target.value) setEntrada(f.maquina_id, Number(e.target.value), true);
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

                      <div className="tf-actions">
                        <button className="danger" onClick={() => quitar(f.maquina_id)} title="Quitar">✕</button>
                      </div>
                    </div>
                  ))}
                </div>

                {ci < columnasEditor.length - 1 && <span className="tf-arrow">→</span>}
              </div>
            ))}

            <div className={`tf-cell tf-add-cell ${sobre === 'nueva' ? 'drop-zone' : ''}`}
                 onDragOver={e => { e.preventDefault(); setSobre('nueva'); }}
                 onDrop={e => {
                   e.preventDefault();
                   const id = Number(e.dataTransfer.getData('text/plain'));
                   soltarEnNuevaEtapa(id);
                 }}>
              <button className="tf-add" title="Agregar equipo o soltar acá para nueva etapa"
                      onClick={() => document.getElementById('add-maquina')?.focus()}>＋</button>
            </div>
          </div>

          <div className="add-row">
            <select id="add-maquina" value={editor.nueva}
                    onChange={e => setEditor(prev => ({ ...prev, nueva: e.target.value }))}>
              <option value="">Agregar máquina…</option>
              {disponibles.map(m => (
                <option key={m.id} value={m.id}>{m.nombre_corto} · {m.area}</option>
              ))}
            </select>
            <button onClick={agregarMaquina} disabled={!editor.nueva}>Agregar</button>
          </div>
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
