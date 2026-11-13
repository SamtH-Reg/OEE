import { useEffect, useMemo, useState } from 'react';
import { api } from './api';

// Arma una línea en el momento: nombre, especie/producto y equipos en orden.
// Nace con su tarjeta de Eventualidades (la pone el servidor) y después se abre
// el editor de trama para conectar los bloques como se vayan a usar.

const normalizar = (t) =>
  (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export default function LineaRapida({
  areas, maquinas, trama, lineas, armadas = [], inicial = [],
  especies = [], productos = [], onClose, onCrear
}) {
  const [nombre, setNombre] = useState('');
  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState(inicial);
  const [especie, setEspecie] = useState('');
  const [producto, setProducto] = useState('');
  const [listaEsp, setListaEsp] = useState(especies);
  const [listaProd, setListaProd] = useState(productos);
  const [nuevo, setNuevo] = useState(null);   // {tipo: 'especie'|'producto', nombre}
  const [error, setError] = useState(null);
  const [creando, setCreando] = useState(false);

  // el catálogo llega después de abrir el panel: se sincroniza al recibirlo
  useEffect(() => { setListaEsp(especies); }, [especies]);
  useEffect(() => { setListaProd(productos); }, [productos]);

  const grupos = useMemo(() => {
    const q = normalizar(busca.trim());
    const lista = (maquinas || []).filter(m => m.activa !== false)
      .filter(m => !q || normalizar(`${m.nombre} ${m.nombre_corto}`).includes(q));
    return (areas || [])
      .map(a => ({ area: a.nombre, items: lista.filter(m => m.area_id === a.id) }))
      .filter(g => g.items.length);
  }, [areas, maquinas, busca]);

  function otrasLineas(maquinaId) {
    return (trama || [])
      .filter(t => t.maquina_id === maquinaId)
      .map(t => {
        const l = lineas.find(x => x.linea_id === t.linea_id);
        return {
          nombre: l ? l.nombre : `línea ${t.linea_id}`,
          armada: armadas.includes(t.linea_id)
        };
      });
  }

  function toggle(id) {
    setSel(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function crearCatalogo() {
    if (!nuevo || !nuevo.nombre.trim()) return;
    try {
      const creado = nuevo.tipo === 'especie'
        ? await api.crearEspecie({ nombre: nuevo.nombre.trim() })
        : await api.crearProducto({ nombre: nuevo.nombre.trim() });
      if (nuevo.tipo === 'especie') {
        setListaEsp(prev => [...prev, creado]);
        setEspecie(String(creado.id));
      } else {
        setListaProd(prev => [...prev, creado]);
        setProducto(String(creado.id));
      }
      setNuevo(null);
    } catch (e) {
      setError(e.message);
    }
  }

  async function crear() {
    if (!nombre.trim() || !sel.length) return;
    setCreando(true);
    setError(null);
    try {
      await onCrear({
        nombre: nombre.trim(), equipos: sel,
        especie_id: especie ? Number(especie) : null,
        producto_id: producto ? Number(producto) : null
      });
    } catch (e) {
      setError(e.message);
      setCreando(false);
    }
  }

  return (
    <div className="wizard">
      <div className="wz-head">
        <div>
          <div className="wz-kicker">Línea nueva</div>
          <h2>Armar la línea con los equipos de ahora</h2>
        </div>
        <button className="x" onClick={onClose} aria-label="Cerrar">✕</button>
      </div>

      <div className="wz-body">
        <div className="wz-card">
          <label className="lr-nombre">
            Nombre de la línea
            <input value={nombre} onChange={e => setNombre(e.target.value)}
                   placeholder="LINEA 4" autoFocus />
          </label>

          <div className="lr-clasif">
            <label className="lr-campo">
              Especie
              <span className="lr-select">
                <select value={especie} onChange={e => setEspecie(e.target.value)}>
                  <option value="">Sin especie</option>
                  {listaEsp.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
                <button type="button" title="Nueva especie"
                        onClick={() => setNuevo({ tipo: 'especie', nombre: '' })}>＋</button>
              </span>
            </label>
            <label className="lr-campo">
              Producto
              <span className="lr-select">
                <select value={producto} onChange={e => setProducto(e.target.value)}>
                  <option value="">Sin producto</option>
                  {listaProd.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
                <button type="button" title="Nuevo producto"
                        onClick={() => setNuevo({ tipo: 'producto', nombre: '' })}>＋</button>
              </span>
            </label>
          </div>

          {nuevo && (
            <div className="lr-nuevo">
              <span>{nuevo.tipo === 'especie' ? 'Nueva especie' : 'Nuevo producto'}</span>
              <input value={nuevo.nombre} autoFocus placeholder="Nombre"
                     onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })}
                     onKeyDown={e => { if (e.key === 'Enter') crearCatalogo(); }} />
              <button className="btn-go small" onClick={crearCatalogo}
                      disabled={!nuevo.nombre.trim()}>Crear</button>
              <button className="ghost" onClick={() => setNuevo(null)}>Cancelar</button>
            </div>
          )}

          <div className="lr-busca">
            <input placeholder="Buscar equipo…" value={busca}
                   onChange={e => setBusca(e.target.value)} />
            <span><b>{sel.length}</b> elegido{sel.length === 1 ? '' : 's'}</span>
          </div>

          <div className="lr-lista">
            {grupos.map(g => (
              <div key={g.area} className="lr-grupo">
                <div className="lr-area">{g.area}</div>
                {g.items.map(m => {
                  const orden = sel.indexOf(m.id);
                  const otras = otrasLineas(m.id);
                  const ocupada = otras.some(o => o.armada);
                  return (
                    <button key={m.id} className={`lr-item ${orden >= 0 ? 'on' : ''}`}
                            onClick={() => toggle(m.id)}>
                      <span className="lr-orden">{orden >= 0 ? orden + 1 : ''}</span>
                      <span className="lr-maq">
                        <b>{m.nombre_corto}</b>
                        <small>{m.nombre}</small>
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
              </div>
            ))}
            {!grupos.length && <div className="lr-vacio">Ningún equipo con ese nombre.</div>}
          </div>
        </div>
      </div>

      <div className="wz-foot">
        <span className="err">{error || ''}</span>
        <button className="ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-go small" onClick={crear}
                disabled={!nombre.trim() || !sel.length || creando}>
          {creando ? 'Creando…' : `Crear línea (${sel.length} ${sel.length === 1 ? 'equipo' : 'equipos'})`}
        </button>
      </div>
    </div>
  );
}
