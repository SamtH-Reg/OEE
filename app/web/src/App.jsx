import { useEffect, useMemo, useState } from 'react';
import {
  db, guardarCatalogo, leerCatalogo, leerMaquinas, guardarMaquinas,
  encolar, deshacer
} from './db';
import { api } from './api';
import { arrancarSync } from './sync';

const nf = new Intl.NumberFormat('es-CL');

// Íconos por categoría (el catálogo trae el nombre del ícono)
const ICONOS = {
  engranaje: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  rayo: 'M13 2 4.1 12.8a.7.7 0 0 0 .5 1.2H10l-1 8 8.9-10.8a.7.7 0 0 0-.5-1.2H13Z',
  gota: 'M12 2.5 6.6 9.2a7 7 0 1 0 10.8 0L12 2.5Z',
  herramienta: 'M20.7 3.3a5.5 5.5 0 0 1-6.7 7.1L4.6 19.8a2.2 2.2 0 0 1-3.1-3.1l9.4-9.4a5.5 5.5 0 0 1 7.1-6.7l-3 3 2.3 2.3 3-3Z',
  camion: 'M2 7h11v9H2z M13 10h4l4 4v2h-8z M6 18.2a1.7 1.7 0 1 0 0 .1Z M17.5 18.2a1.7 1.7 0 1 0 0 .1Z'
};

function duracion(desde, ahora) {
  if (!desde) return '';
  const min = Math.max(0, Math.floor((ahora - new Date(desde).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

export default function App() {
  const [cat, setCat] = useState(null);
  const [maqs, setMaqs] = useState({});
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState(null);
  const [pend, setPend] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [ahora, setAhora] = useState(Date.now());
  const [error, setError] = useState(null);
  const [sinRed, setSinRed] = useState(false);

  // ---- arranque: catálogo local primero, red después ----
  useEffect(() => {
    let vivo = true;
    (async () => {
      const local = await leerCatalogo();
      if (local && vivo) setCat(local);
      try {
        const fresco = await api.catalogo();
        if (vivo) setCat(fresco);
        await guardarCatalogo(fresco);
      } catch {
        // sin red: seguimos con el catálogo cacheado
        if (vivo) setSinRed(true);
      }

      const maquinasLocales = await leerMaquinas();
      if (vivo && maquinasLocales.length) {
        setMaqs(Object.fromEntries(maquinasLocales.map(m => [m.id, m])));
      }
      try {
        const { maquinas } = await api.tablero();
        if (vivo) { setSinRed(false); setError(null); }
        const pendientesUuid = new Set((await db.outbox.toArray()).map(e => e.uuid));
        const lista = maquinas.map(m => ({
          id: m.id, codigo: m.codigo, nombre: m.nombre, nombre_corto: m.nombre_corto,
          area_id: m.area_id, area: m.area,
          estado: m.uuid_cliente ? (m.es_planificada ? 'plan' : 'stop') : 'run',
          uuid: m.uuid_cliente || null,
          causa: m.causa || null,
          hora_inicio: m.hora_inicio || null
        }));
        if (vivo) {
          setMaqs(prev => {
            const next = { ...prev };
            for (const m of lista) {
              const localM = prev[m.id];
              if (localM && localM.uuid && pendientesUuid.has(localM.uuid)) continue;
              next[m.id] = m;
            }
            return next;
          });
          await guardarMaquinas(lista.filter(m => !pendientesUuid.has(m.uuid)));
        }
      } catch (e) {
        // sin red: el tablero sale de IndexedDB y se sigue registrando
        console.warn('tablero sin red', e.message);
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

  // el aviso de la parada desaparece a los 5 s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const areas = useMemo(() => {
    if (!cat) return [];
    return cat.areas.map(a => ({
      ...a,
      maquinas: Object.values(maqs).filter(m => m.area_id === a.id)
    }));
  }, [cat, maqs]);

  const activas = Object.values(maqs).filter(m => m.estado !== 'run').length;

  // ---- acciones ----
  function tocar(maq) {
    if (!cat) return;
    setError(null);
    if (maq.estado === 'run') setSheet({ tipo: 'categorias', maquina: maq });
    else setSheet({ tipo: 'reanudar', maquina: maq });
  }

  async function registrar(maq, causa, categoria) {
    const uuid = crypto.randomUUID();
    const inicio = new Date().toISOString();
    const actualizada = {
      ...maq,
      estado: causa.es_planificada ? 'plan' : 'stop',
      uuid, causa: causa.descripcion, categoria: categoria.nombre, hora_inicio: inicio
    };
    setMaqs(p => ({ ...p, [maq.id]: actualizada }));
    await db.maquinas.put(actualizada);
    try {
      const evId = await encolar({
        tipo: 'abrir', uuid, maquina_id: maq.id, causa_id: causa.id,
        hora_inicio: inicio, impacto: 'Total'
      });
      setPend(await db.outbox.count());
      setSheet(null);
      setToast({
        titulo: 'Parada registrada',
        detalle: `${maq.nombre_corto} · ${causa.descripcion}`,
        eventoId: evId, volver: { ...maq, estado: 'run', uuid: null, causa: null, hora_inicio: null }
      });
    } catch (e) {
      setError('No se pudo guardar el registro: ' + e.message);
    }
  }

  async function reanudar(maq, comentario) {
    const fin = new Date().toISOString();
    const minutos = duracion(maq.hora_inicio, Date.now());
    const actualizada = { ...maq, estado: 'run', uuid: null, causa: null, hora_inicio: null };
    setMaqs(p => ({ ...p, [maq.id]: actualizada }));
    await db.maquinas.put(actualizada);
    const evId = await encolar({ tipo: 'cerrar', uuid: maq.uuid, hora_fin: fin, comentario: comentario || null });
    setPend(await db.outbox.count());
    setSheet(null);
    setToast({
      titulo: 'Operación reanudada',
      detalle: `${maq.nombre_corto} · ${minutos} de parada`,
      eventoId: evId, volver: maq
    });
  }

  async function deshacerRegistro() {
    if (!toast) return;
    await deshacer(toast.eventoId);
    await db.maquinas.put(toast.volver);
    setMaqs(p => ({ ...p, [toast.volver.id]: toast.volver }));
    setPend(await db.outbox.count());
    setToast(null);
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
            </span>
          </div>
        </div>

        <div className="hint"><kbd>1</kbd> toca la máquina <b>·</b> <kbd>2</kbd> toca la causa</div>

        <div className={`net ${online && !sinRed ? '' : 'off'}`}>
          <i /> <span>{online && !sinRed ? 'En línea' : 'Sin enlace'}</span>
          <span className="dim">|</span>
          <span>{pend === 0 ? 'sin pendientes' : `${pend} ${pend === 1 ? 'pendiente' : 'pendientes'}`}</span>
        </div>

        <div className="clock">
          <b>{new Date(ahora).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</b>
          <span>{new Date(ahora).toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' })}</span>
        </div>
      </header>

      {!cat && <div className="aviso">Cargando catálogo de planta…</div>}
      {sinRed && (
        <div className="aviso off">
          Sin conexión · los registros quedan en la tablet y se envían al volver la red
        </div>
      )}
      {error && <div className="aviso error">{error}</div>}

      <main className="board">
        {areas.map(a => (
          <section className="area" key={a.id}>
            <h2>{a.nombre} <em>{a.maquinas.length}</em></h2>
            {a.maquinas.map(m => (
              <button key={m.id} className={`tile ${m.estado}`} onClick={() => tocar(m)}>
                <div>
                  <div className="code">{m.codigo}</div>
                  <div className="name">{m.nombre_corto}</div>
                </div>
                <div className="state">
                  {m.estado === 'run' && <><span className="ico">▶</span> Operando</>}
                  {m.estado === 'stop' && <><span className="ico">■</span> {m.causa} · {duracion(m.hora_inicio, ahora)}</>}
                  {m.estado === 'plan' && <><span className="ico">◷</span> {m.causa}</>}
                </div>
                {m.estado === 'stop' && <span className="pulse" />}
              </button>
            ))}
          </section>
        ))}
      </main>

      <footer>
        <span>{activas} {activas === 1 ? 'máquina detenida' : 'máquinas detenidas'}</span>
        <span>{nf.format(Object.keys(maqs).length)} máquinas en planta</span>
      </footer>

      {/* ---- paneles ---- */}
      {sheet?.tipo === 'categorias' && (
        <div className="sheet">
          <div className="top">
            <div>
              <h3>{sheet.maquina.nombre}</h3>
              <div className="sub">{sheet.maquina.codigo} · ¿qué la detuvo?</div>
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
                Parada en curso · {sheet.maquina.causa} ·{' '}
                {sheet.maquina.estado === 'plan' ? 'planificada' : 'no planificada'}
              </div>
            </div>
            <button className="x" onClick={() => setSheet(null)}>✕</button>
          </div>
          <div className="resume">
            <div className="timer">{duracion(sheet.maquina.hora_inicio, ahora)}</div>
            <button className="btn-go" onClick={() => {
              const txt = document.getElementById('comment')?.value || '';
              reanudar(sheet.maquina, txt);
            }}>▶ Reanudar operación</button>
            <textarea id="comment" className="comment" placeholder="Comentario (opcional)" />
          </div>
        </div>
      )}

      {toast && (
        <div className="toast">
          <div>
            <b>{toast.titulo}</b>
            <small>{toast.detalle}</small>
          </div>
          <button onClick={deshacerRegistro}>Deshacer</button>
        </div>
      )}
    </div>
  );
}
