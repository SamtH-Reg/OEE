import { useEffect, useMemo, useState } from 'react';
import { api } from './api';

const hhmm = (iso) => new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
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
// color por familia de causa, para leer la línea de tiempo de un vistazo
const color = (p) => {
  if (!p.hora_fin) return '#E58E26';                 // en curso
  if (p.es_planificada) return '#2F80ED';            // planificada (fin de turno, etc.)
  return '#D64545';                                  // falla real
};

export default function LineaParadas({ lineaId, causas = [], onCambio }) {
  const [paradas, setParadas] = useState([]);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function cargar() {
    setCargando(true);
    try {
      const r = await api.paradasLinea(lineaId);
      setParadas(r.paradas || []);
    } catch { /* sin red */ }
    setCargando(false);
  }
  useEffect(() => { cargar(); /* eslint-disable-next-line */ }, [lineaId]);

  const total = paradas.reduce((s, p) => s + (p.minutos || 0), 0);
  const ventana = useMemo(() => {
    if (!paradas.length) return null;
    const inicios = paradas.map(p => new Date(p.hora_inicio).getTime());
    const fines = paradas.map(p => (p.hora_fin ? new Date(p.hora_fin).getTime() : Date.now()));
    const desde = Math.min(...inicios);
    const hasta = Math.max(...fines, Date.now());
    return { desde, hasta, ancho: Math.max(1, hasta - desde) };
  }, [paradas]);

  async function guardar() {
    try {
      const orig = paradas.find(x => x.id === edit.id) || {};
      await api.editarParada(edit.id, {
        hora_inicio: edit.desde !== orig.desde ? new Date(edit.desde).toISOString() : orig.hora_inicio,
        hora_fin: !edit.hasta
          ? null
          : (edit.hasta !== orig.hasta ? new Date(edit.hasta).toISOString() : orig.hora_fin),
        codigo_causa_id: edit.causa ? Number(edit.causa) : null,
        comentario: edit.comentario
      });
      setEdit(null); setError(null);
      await cargar();
      onCambio && onCambio();
    } catch (e) { setError(e.message); }
  }

  async function anular(p) {
    try {
      await api.anularParada(p.id, 'cargada por error');
      await cargar();
      onCambio && onCambio();
    } catch (e) { setError(e.message); }
  }

  return (
    <section className="lp">
      <div className="lp-head">
        <b>Fallas de la línea</b>
        <span className="lp-dato">{paradas.length} {paradas.length === 1 ? 'parada' : 'paradas'} · {fmtMin(total)}</span>
        <button className="lp-ref" onClick={cargar} title="Actualizar" disabled={cargando}>⟳</button>
      </div>

      {ventana && (
        <div className="lp-bar" title="Cada bloque es una parada; el ancho es su duración">
          {paradas.map(p => {
            const ini = new Date(p.hora_inicio).getTime();
            const fin = p.hora_fin ? new Date(p.hora_fin).getTime() : Date.now();
            const izq = ((ini - ventana.desde) / ventana.ancho) * 100;
            const ancho = Math.max(0.6, ((fin - ini) / ventana.ancho) * 100);
            return (
              <button key={p.id} className="lp-seg" onClick={() => setEdit({
                id: p.id, causa: p.codigo_causa_id || '', comentario: p.comentarios_operador || '',
                desde: aInput(p.hora_inicio), hasta: p.hora_fin ? aInput(p.hora_fin) : '',
                desdeOrig: aInput(p.hora_inicio), hastaOrig: p.hora_fin ? aInput(p.hora_fin) : '',
                hora_inicio: p.hora_inicio, hora_fin: p.hora_fin
              })}
                style={{ left: `${izq}%`, width: `${ancho}%`, background: color(p) }}
                title={`${hhmm(p.hora_inicio)} · ${p.maquina} · ${p.causa || 'sin causa'} · ${fmtMin(p.minutos)}`} />
            );
          })}
        </div>
      )}

      {!paradas.length && <p className="lp-vacio">Sin paradas registradas en esta línea.</p>}

      <ul className="lp-list">
        {paradas.slice(0, 12).map(p => (
          <li key={p.id}>
            <span className="lp-hora">{hhmm(p.hora_inicio)}{p.hora_fin ? `–${hhmm(p.hora_fin)}` : ' · en curso'}</span>
            <span className="lp-maq">{p.maquina}</span>
            <span className="lp-causa" style={{ color: color(p) }}>{p.causa || 'sin causa'}</span>
            <span className="lp-dur">{fmtMin(p.minutos)}</span>
            <button className="lp-btn" title="Corregir"
                    onClick={() => setEdit({
                      id: p.id, causa: p.codigo_causa_id || '', comentario: p.comentarios_operador || '',
                      desde: aInput(p.hora_inicio), hasta: p.hora_fin ? aInput(p.hora_fin) : '',
                      desdeOrig: aInput(p.hora_inicio), hastaOrig: p.hora_fin ? aInput(p.hora_fin) : '',
                      hora_inicio: p.hora_inicio, hora_fin: p.hora_fin
                    })}>✎</button>
            <button className="lp-btn peligro" title="Anular (no cuenta en los análisis)"
                    onClick={() => anular(p)}>✕</button>
          </li>
        ))}
      </ul>

      {edit && (
        <div className="confirma-capa" onClick={() => setEdit(null)}>
          <div className="confirma" onClick={e => e.stopPropagation()}>
            <h3>Corregir la parada</h3>
            <p>Si la cargaste por error, anulala: deja de contar en los análisis.</p>
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
