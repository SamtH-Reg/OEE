import { useMemo, useState } from 'react';
import { api } from './api';

// Asistente: línea -> equipos -> especie/producto, en un solo recorrido.
// Crea lo que falte sin salir del flujo.

let seq = 2;
const nuevaFila = () => ({ key: seq++, maquina_id: null, nombre: '', area_id: '', detiene_linea: false });

export default function WizardLinea({ data, onClose, onSaved }) {
  const [paso, setPaso] = useState(1);
  const [linea, setLinea] = useState({ nombre: '', descripcion: '' });
  const [filas, setFilas] = useState([{ ...nuevaFila(), detiene_linea: true }]);
  const [prod, setProd] = useState({ especie_id: '', producto_id: '' });
  const [nuevo, setNuevo] = useState(null); // {tipo, nombre}
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const areas = data.areas;
  const maquinas = data.maquinas.filter(m => m.activa);

  const filasValidas = useMemo(
    () => filas.filter(f => (f.maquina_id || f.nombre.trim()) && (f.maquina_id || f.area_id)),
    [filas]
  );

  function setFila(key, campo, valor) {
    setFilas(prev => prev.map(f => (f.key === key ? { ...f, [campo]: valor } : f)));
  }
  function agregarFila() { setFilas(prev => [...prev, nuevaFila()]); }
  function quitarFila(key) { setFilas(prev => (prev.length === 1 ? prev : prev.filter(f => f.key !== key))); }
  function mover(key, dir) {
    setFilas(prev => {
      const i = prev.findIndex(f => f.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const copia = [...prev];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });
  }
  function marcarCuello(key) {
    setFilas(prev => prev.map(f => ({ ...f, detiene_linea: f.key === key })));
  }

  async function crearCatalogo() {
    if (!nuevo || !nuevo.nombre.trim()) return;
    try {
      const creado = nuevo.tipo === 'especie'
        ? await api.crearEspecie({ nombre: nuevo.nombre })
        : await api.crearProducto({ nombre: nuevo.nombre });
      const fresca = await api.settings();
      data.especies = fresca.especies;
      data.productos = fresca.productos;
      setProd(p => ({ ...p, [nuevo.tipo === 'especie' ? 'especie_id' : 'producto_id']: creado.id }));
      setNuevo(null);
    } catch (e) {
      setError(e.message);
    }
  }

  function siguiente() {
    setError(null);
    if (paso === 1 && !linea.nombre.trim()) {
      setError('Ponle un nombre a la línea.');
      return;
    }
    if (paso === 2 && filasValidas.length === 0) {
      setError('Agrega al menos un equipo (elige uno o escribe su nombre).');
      return;
    }
    setPaso(paso + 1);
  }

  async function terminar() {
    setError(null);
    setGuardando(true);
    try {
      const l = await api.crearLinea({
        nombre: linea.nombre,
        descripcion: linea.descripcion,
        especie_id: prod.especie_id || null,
        producto_id: prod.producto_id || null
      });

      const resueltas = [];
      for (const f of filas) {
        if (!f.maquina_id && !f.nombre.trim()) continue;
        let maquinaId = f.maquina_id;
        if (!maquinaId) {
          const m = await api.crearMaquina({ area_id: Number(f.area_id), nombre: f.nombre, nombre_corto: f.nombre });
          maquinaId = m.id;
        }
        resueltas.push({ maquina_id: maquinaId, detiene_linea: !!f.detiene_linea });
      }
      await api.guardarTrama(l.id, resueltas);

      onSaved && await onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  const pasos = ['La línea', 'Sus equipos', 'Especie y producto'];

  return (
    <div className="wizard">
      <div className="wz-head">
        <div>
          <div className="wz-kicker">Armar línea</div>
          <h2>{pasos[paso - 1]}</h2>
        </div>
        <div className="wz-steps">
          {pasos.map((p, i) => (
            <button key={p} className={`wz-step ${paso === i + 1 ? 'on' : ''} ${paso > i + 1 ? 'done' : ''}`}
                    onClick={() => i + 1 < paso && setPaso(i + 1)}>
              <span>{paso > i + 1 ? '✓' : i + 1}</span> {p}
            </button>
          ))}
        </div>
        <button className="x" onClick={onClose}>✕</button>
      </div>

      <div className="wz-body">
        {paso === 1 && (
          <div className="wz-card">
            <p className="wz-help">
              Es el nombre con el que vas a reconocer la línea en el tablero. Ejemplo: «Línea 4 · Jibia».
            </p>
            <label className="wz-field">
              <span className="lbl">Nombre de la línea</span>
              <input autoFocus value={linea.nombre} onChange={e => setLinea({ ...linea, nombre: e.target.value })}
                     placeholder="Línea 4 · Jibia" />
            </label>
            <label className="wz-field">
              <span className="lbl">Descripción <em>opcional</em></span>
              <input value={linea.descripcion} onChange={e => setLinea({ ...linea, descripcion: e.target.value })}
                     placeholder="Recepción → cocido → empaque" />
            </label>
          </div>
        )}

        {paso === 2 && (
          <div className="wz-card">
            <p className="wz-help">
              El orden es el recorrido del producto. El <strong>cuello de línea</strong> es el equipo que, si se
              detiene, para toda la línea; los demás solo detienen lo que viene después.
            </p>

            <div className="wz-rows">
              {filas.map((f, i) => (
                <div className="wz-row" key={f.key}>
                  <span className="wz-pos">{i + 1}</span>

                  <select className="wz-sel" value={f.maquina_id || ''}
                          onChange={e => setFila(f.key, 'maquina_id', e.target.value ? Number(e.target.value) : null)}>
                    <option value="">＋ Equipo nuevo…</option>
                    {maquinas.map(m => <option key={m.id} value={m.id}>{m.nombre_corto} · {m.area || ''}</option>)}
                  </select>

                  {!f.maquina_id && (
                    <>
                      <input className="wz-input" placeholder="Nombre del equipo" value={f.nombre}
                             onChange={e => setFila(f.key, 'nombre', e.target.value)} />
                      <select className="wz-sel sm" value={f.area_id}
                              onChange={e => setFila(f.key, 'area_id', Number(e.target.value))}>
                        <option value="">Área…</option>
                        {areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                      </select>
                    </>
                  )}

                  <label className={`wz-cuello ${f.detiene_linea ? 'on' : ''}`}>
                    <input type="radio" name="cuello" checked={f.detiene_linea}
                           onChange={() => marcarCuello(f.key)} />
                    cuello
                  </label>

                  <div className="wz-acc">
                    <button onClick={() => mover(f.key, -1)} disabled={i === 0}>↑</button>
                    <button onClick={() => mover(f.key, 1)} disabled={i === filas.length - 1}>↓</button>
                    <button onClick={() => quitarFila(f.key)} disabled={filas.length === 1}>✕</button>
                  </div>
                </div>
              ))}
            </div>

            <button className="wz-add" onClick={agregarFila}>＋ Agregar equipo</button>
            <p className="wz-count">{filasValidas.length} equipo(s) en la línea</p>
          </div>
        )}

        {paso === 3 && (
          <div className="wz-card">
            <p className="wz-help">
              Qué produce esta línea. Se puede completar después y no es obligatorio para operar.
            </p>

            <div className="wz-grid">
              <label className="wz-field">
                <span className="lbl">Especie</span>
                <div className="inline">
                  <select value={prod.especie_id}
                          onChange={e => setProd({ ...prod, especie_id: e.target.value ? Number(e.target.value) : '' })}>
                    <option value="">Elegir…</option>
                    {data.especies.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                  </select>
                  <button className="mini" title="Nueva especie"
                          onClick={() => setNuevo({ tipo: 'especie', nombre: '' })}>＋</button>
                </div>
              </label>

              <label className="wz-field">
                <span className="lbl">Producto</span>
                <div className="inline">
                  <select value={prod.producto_id}
                          onChange={e => setProd({ ...prod, producto_id: e.target.value ? Number(e.target.value) : '' })}>
                    <option value="">Elegir…</option>
                    {data.productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                  <button className="mini" title="Nuevo producto"
                          onClick={() => setNuevo({ tipo: 'producto', nombre: '' })}>＋</button>
                </div>
              </label>
            </div>

            <p className="wz-help">
              Con «＋» creás una especie o un producto nuevo sin salir de acá; queda seleccionado al instante.
            </p>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}
      </div>

      <div className="wz-foot">
        <button className="ghost" onClick={onClose}>Cancelar</button>
        {paso > 1 && <button className="ghost" onClick={() => setPaso(paso - 1)}>← Atrás</button>}
        {paso < 3
          ? <button className="btn-go small" onClick={siguiente}>Siguiente →</button>
          : <button className="btn-go small" onClick={terminar} disabled={guardando}>
              {guardando ? 'Creando…' : 'Crear línea'}
            </button>}
      </div>

      {nuevo && (
        <div className="form-layer">
          <div className="form-card mini-card">
            <div className="form-head">
              <h3>{nuevo.tipo === 'especie' ? 'Nueva especie' : 'Nuevo producto'}</h3>
              <button className="x" onClick={() => setNuevo(null)}>✕</button>
            </div>
            <div className="form-grid">
              <label className="wide">Nombre
                <input autoFocus value={nuevo.nombre}
                       onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })}
                       placeholder="Reineta" />
              </label>
            </div>
            <div className="form-foot">
              <button className="ghost" onClick={() => setNuevo(null)}>Cancelar</button>
              <button className="btn-go small" onClick={crearCatalogo}>Crear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
