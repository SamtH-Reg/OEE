import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import WizardLinea from './WizardLinea';

const vacio = {
  linea: { codigo: '', nombre: '', descripcion: '', activa: true },
  maquina: { area_id: '', codigo: '', nombre: '', nombre_corto: '', criticidad: 2, activa: true, causas: [] },
  receta: {
    codigo: '', nombre: '', especie_id: '', producto_id: '', linea_id: '',
    toneladas_turno: '', rendimiento_pct: '', vigente_desde: '', vigente_hasta: '',
    activa: true, notas: '', distribucion: []
  }
};

export default function Settings({ onClose, onTrama, onSaved }) {
  const [tab, setTab] = useState('lineas');
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);      // {tipo, item, valores, error}
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [nuevo, setNuevo] = useState(null);    // {tipo:'especie'|'producto', codigo, nombre}
  const [wizard, setWizard] = useState(false);
  const [demo, setDemo] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [nuevaFalla, setNuevaFalla] = useState(null);
  const [areasEdit, setAreasEdit] = useState(null);

  async function cargar() {
    try {
      setData(await api.settings());
      setDemo(await api.demo());
      setError(null);
    } catch (e) {
      setError('No se pudieron cargar los ajustes: ' + e.message);
    }
  }

  useEffect(() => { cargar(); }, []);

  // Auto-foco SOLO al abrir el formulario. Con [form] como dependencia el efecto
  // se re-ejecutaba en cada tecla y devolvía el cursor al primer campo.
  useEffect(() => {
    if (!form) return;
    const t = setTimeout(() => document.getElementById('form-first')?.focus(), 30);
    return () => clearTimeout(t);
  }, [form?.tipo, form?.item?.id]);

  function abrir(tipo, item) {
    const base = item
      ? {
          ...item,
          causas: tipo === 'maquina'
            ? (data.maquina_causas || []).filter(x => x.maquina_id === item.id).map(x => x.codigo_causa_id)
            : [],
          vigente_desde: item.vigente_desde ? String(item.vigente_desde).slice(0, 10) : '',
          vigente_hasta: item.vigente_hasta ? String(item.vigente_hasta).slice(0, 10) : '',
          distribucion: (data.distribucion || [])
            .filter(d => d.receta_id === item.id)
            .map(d => ({ maquina_id: d.maquina_id, porcentaje: Number(d.porcentaje) }))
        }
      : JSON.parse(JSON.stringify(vacio[tipo]));
    setForm({ tipo, item: item || null, valores: base, error: null });
  }

  const set = (campo, valor) =>
    setForm(prev => ({ ...prev, valores: { ...prev.valores, [campo]: valor } }));

  async function guardar() {
    const { tipo, item, valores } = form;
    setGuardando(true);
    try {
      let r;
      if (tipo === 'linea') {
        r = item ? await api.editarLinea(item.id, valores) : await api.crearLinea(valores);
      } else if (tipo === 'maquina') {
        r = item ? await api.editarMaquina(item.id, valores) : await api.crearMaquina(valores);
      } else {
        r = item ? await api.editarReceta(item.id, valores) : await api.crearReceta(valores);
      }
      setForm(null);
      await cargar();
      onSaved && onSaved();
      return r;
    } catch (e) {
      setForm(prev => ({ ...prev, error: e.message }));
    } finally {
      setGuardando(false);
    }
  }

  function abrirAreas() {
    setAreasEdit(data.areas.map(a => ({ ...a })));
  }

  function setArea(i, campo, valor) {
    setAreasEdit(prev => prev.map((a, k) => (k === i ? { ...a, [campo]: valor } : a)));
  }

  async function guardarArea(i) {
    const a = areasEdit[i];
    if (!a.nombre.trim()) return;
    try {
      if (a.id) await api.editarArea(a.id, { nombre: a.nombre, orden: a.orden });
      else await api.crearArea({ nombre: a.nombre, orden: a.orden });
      const fresca = await api.settings();
      data.areas = fresca.areas;
      data.maquinas = fresca.maquinas;
      setAreasEdit(fresca.areas.map(x => ({ ...x })));
      await cargar();
      onSaved && onSaved();
    } catch (e) {
      setError(e.message);
    }
  }

  function toggleCausa(id) {
    const actuales = form.valores.causas || [];
    set('causas', actuales.includes(id) ? actuales.filter(x => x !== id) : [...actuales, id]);
  }

  async function crearFalla() {
    if (!nuevaFalla || !nuevaFalla.descripcion.trim()) return;
    try {
      const c = await api.crearCausa(nuevaFalla);
      await cargar();
      set('causas', [...(form.valores.causas || []), c.id]);
      setNuevaFalla(null);
    } catch (e) {
      setForm(prev => ({ ...prev, error: e.message }));
    }
  }

  async function borrarDemo() {
    setBorrando(true);
    try {
      await api.eliminarDemo();
      setConfirmando(false);
      await cargar();
      onSaved && onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBorrando(false);
    }
  }

  async function crearCatalogo() {
    if (!nuevo || !nuevo.codigo || !nuevo.nombre) return;
    try {
      const creado = nuevo.tipo === 'especie'
        ? await api.crearEspecie({ codigo: nuevo.codigo, nombre: nuevo.nombre })
        : await api.crearProducto({ codigo: nuevo.codigo, nombre: nuevo.nombre });
      await cargar();
      setNuevo(null);
      if (form && form.tipo === 'receta') {
        set(nuevo.tipo === 'especie' ? 'especie_id' : 'producto_id', creado.id);
      }
    } catch (e) {
      setForm(prev => (prev ? { ...prev, error: e.message } : prev));
    }
  }

  const maquinasDeLinea = useMemo(() => {
    if (!data || !form || form.tipo !== 'receta' || !form.valores.linea_id) return [];
    return (data.trama || [])
      .filter(t => t.linea_id === Number(form.valores.linea_id))
      .sort((a, b) => a.posicion - b.posicion)
      .map(t => {
        const m = data.maquinas.find(x => x.id === t.maquina_id);
        const actual = (form.valores.distribucion || []).find(d => d.maquina_id === t.maquina_id);
        return { ...t, maquina: m, porcentaje: actual ? actual.porcentaje : 100, incluida: Boolean(actual) };
      });
  }, [data, form]);

  function toggleMaquinaReceta(maquinaId, incluida) {
    const dist = [...(form.valores.distribucion || [])];
    if (incluida) {
      if (!dist.some(d => d.maquina_id === maquinaId)) dist.push({ maquina_id: maquinaId, porcentaje: 100 });
    } else {
      const i = dist.findIndex(d => d.maquina_id === maquinaId);
      if (i >= 0) dist.splice(i, 1);
    }
    set('distribucion', dist);
  }

  function setPorcentaje(maquinaId, valor) {
    const dist = [...(form.valores.distribucion || [])];
    const i = dist.findIndex(d => d.maquina_id === maquinaId);
    const pct = Math.max(1, Math.min(100, Number(valor) || 0));
    if (i >= 0) dist[i] = { ...dist[i], porcentaje: pct };
    else dist.push({ maquina_id: maquinaId, porcentaje: pct });
    set('distribucion', dist);
  }

  if (!data) {
    return (
      <div className="settings">
        <div className="set-head">
          <h2>Ajustes</h2>
          <button className="x" onClick={onClose}>✕</button>
        </div>
        <div className="set-body"><p>{error || 'Cargando…'}</p></div>
      </div>
    );
  }

  return (
    <div className="settings">
      <div className="set-head">
        <h2>Ajustes de planta</h2>
        <div className="tabs">
          <button className={tab === 'lineas' ? 'on' : ''} onClick={() => setTab('lineas')}>Líneas</button>
          <button className={tab === 'equipos' ? 'on' : ''} onClick={() => setTab('equipos')}>Equipos</button>
          <button className={tab === 'recetas' ? 'on' : ''} onClick={() => setTab('recetas')}>Recetas</button>
          <button className={tab === 'datos' ? 'on' : ''} onClick={() => setTab('datos')}>Datos</button>
        </div>
        <button className="x" onClick={onClose}>✕</button>
      </div>

      <div className="set-body">
        {error && <div className="aviso error">{error}</div>}

        {/* -------- líneas -------- */}
        {tab === 'lineas' && (
          <>
            <div className="set-bar">
              <span className="set-count">{data.lineas.length} líneas</span>
              <button className="btn-add" onClick={() => setWizard(true)}>＋ Armar línea</button>
            </div>
            <p className="set-hint">
              «Armar línea» crea la línea, sus equipos y la receta en un solo recorrido de 3 pasos.
            </p>
            <div className="set-list">
              {data.lineas.map(l => {
                const n = data.trama.filter(t => t.linea_id === l.id).length;
                return (
                  <div className={`set-row ${l.activa ? '' : 'off'}`} key={l.id}>
                    <span className="badge">{l.codigo}</span>
                    <div className="grow">
                      <b>{l.nombre}</b>
                      <small>{n} máquinas{l.descripcion ? ' · ' + l.descripcion : ''}{l.activa ? '' : ' · inactiva'}</small>
                    </div>
                    <button className="btn-ghost" onClick={() => onTrama(l)}>Trama</button>
                    <button className="btn-ghost" onClick={() => abrir('linea', l)}>Editar</button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* -------- equipos -------- */}
        {tab === 'equipos' && (
          <>
            <div className="set-bar">
              <span className="set-count">{data.maquinas.length} equipos en {data.areas.length} áreas</span>
              <button className="btn-ghost" onClick={abrirAreas}>Áreas</button>
              <button className="btn-add" onClick={() => abrir('maquina')}>＋ Nuevo equipo</button>
            </div>
            {data.areas.map(a => {
              const ms = data.maquinas.filter(m => m.area_id === a.id);
              if (!ms.length) return null;
              return (
                <div key={a.id} className="set-group">
                  <div className="group-h">{a.nombre} <em>{ms.length}</em></div>
                  <div className="set-list">
                    {ms.map(m => (
                      <div className={`set-row ${m.activa ? '' : 'off'}`} key={m.id}>
                        <span className="badge sm">{m.codigo}</span>
                        <div className="grow">
                          <b>{m.nombre}</b>
                          <small>{m.nombre_corto} · criticidad {m.criticidad}{m.activa ? '' : ' · inactiva'}</small>
                        </div>
                        <button className="btn-ghost" onClick={() => abrir('maquina', m)}>Editar</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* -------- recetas -------- */}
        {tab === 'recetas' && (
          <>
            <div className="set-bar">
              <span className="set-count">{data.recetas.length} recetas</span>
              <button className="btn-add" onClick={() => abrir('receta')}>＋ Nueva receta</button>
            </div>
            <div className="set-list">
              {data.recetas.map(r => (
                <div className={`set-row ${r.activa ? '' : 'off'}`} key={r.id}>
                  <span className="badge sm">{r.codigo}</span>
                  <div className="grow">
                    <b>{r.nombre}</b>
                    <small>
                      {[r.especie, r.producto].filter(Boolean).join(' · ') || 'sin especie/producto'}
                      {' · '}{r.linea_codigo || 'sin línea'}
                      {r.toneladas_turno ? ` · ${Number(r.toneladas_turno)} t/turno` : ''}
                      {` · ${r.maquinas} máq.`}
                      {r.activa ? '' : ' · inactiva'}
                    </small>
                  </div>
                  <button className="btn-ghost" onClick={() => abrir('receta', r)}>Editar</button>
                </div>
              ))}
            </div>
            <p className="set-hint">
              La receta define especie, producto, línea, toneladas planificadas y cómo se reparte el
              flujo entre las máquinas de esa línea.
            </p>
          </>
        )}

        {/* -------- datos de demostración -------- */}
        {tab === 'datos' && demo && (
          <div className="demo-card">
            <h3>Datos de demostración</h3>
            <p>
              Son los datos de ejemplo cargados para probar el tablero:
              <b> {demo.maquinas} equipos</b>, <b>{demo.lineas} líneas</b>,
              <b> {demo.recetas} recetas</b> y <b>{demo.paradas} paradas</b>.
            </p>
            <p className="set-hint">
              Se conservan las áreas, las especies y los productos, y todo lo que hayas creado vos.
              No se puede deshacer.
            </p>

            {!confirmando ? (
              <button className="btn-danger"
                      disabled={demo.maquinas + demo.lineas + demo.recetas + demo.paradas === 0}
                      onClick={() => setConfirmando(true)}>
                {demo.maquinas + demo.lineas + demo.recetas + demo.paradas === 0
                  ? 'No quedan datos de demostración'
                  : 'Eliminar datos de demostración'}
              </button>
            ) : (
              <div className="confirm">
                <b>
                  ¿Eliminar {demo.maquinas} equipos, {demo.lineas} líneas, {demo.recetas} recetas
                  y {demo.paradas} paradas?
                </b>
                <span>La planta queda vacía para que cargues tus líneas reales.</span>
                <div className="confirm-actions">
                  <button className="ghost" onClick={() => setConfirmando(false)}>Cancelar</button>
                  <button className="btn-danger" onClick={borrarDemo} disabled={borrando}>
                    {borrando ? 'Eliminando…' : 'Sí, eliminar'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* -------- formularios -------- */}
      {wizard && (
        <WizardLinea
          data={data}
          onClose={() => setWizard(false)}
          onSaved={async () => { await cargar(); onSaved && onSaved(); }}
        />
      )}

      {form && (
        <div className="form-layer">
          <div className="form-card"
               onKeyDown={(e) => {
                 if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
                   e.preventDefault();
                   guardar();
                 }
               }}>
            <div className="form-head">
              <h3>
                {form.tipo === 'linea' ? 'Línea' : form.tipo === 'maquina' ? 'Equipo' : 'Receta'}
                {form.item ? ' · editar' : ' · nueva'}
              </h3>
              <button className="x" onClick={() => setForm(null)}>✕</button>
            </div>

            <div className="form-grid">
              {form.tipo === 'linea' && (
                <>
                  <label>Nombre<input id="form-first" value={form.valores.nombre}
                    onChange={e => set('nombre', e.target.value)} placeholder="Línea 4 · Jibia" /></label>
                  <label>Código <span className="opt">opcional · se genera solo</span>
                    <input value={form.valores.codigo}
                      onChange={e => set('codigo', e.target.value)} placeholder="automático" /></label>
                  <label className="wide">Descripción<input value={form.valores.descripcion || ''}
                    onChange={e => set('descripcion', e.target.value)} placeholder="Recepción → cocido → empaque" /></label>
                  <label className="check"><input type="checkbox" checked={!!form.valores.activa}
                    onChange={e => set('activa', e.target.checked)} /> Activa</label>
                </>
              )}

              {form.tipo === 'maquina' && (
                <>
                  <label>Área<select id="form-first" value={form.valores.area_id}
                    onChange={e => set('area_id', Number(e.target.value))}>
                    <option value="">Elegir…</option>
                    {data.areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select></label>
                  <label>Nombre<input value={form.valores.nombre}
                    onChange={e => set('nombre', e.target.value)} placeholder="Cinta Transportadora 3" /></label>
                  <label>Nombre corto <span className="opt">el de la tarjeta</span>
                    <input value={form.valores.nombre_corto || ''}
                      onChange={e => set('nombre_corto', e.target.value)} placeholder="Cinta 3" /></label>
                  <label>Criticidad<select value={form.valores.criticidad}
                    onChange={e => set('criticidad', Number(e.target.value))}>
                    <option value={1}>1 · alta</option><option value={2}>2 · media</option><option value={3}>3 · baja</option>
                  </select></label>
                  <label>Código <span className="opt">opcional · se genera solo</span>
                    <input value={form.valores.codigo}
                      onChange={e => set('codigo', e.target.value)} placeholder="automático" /></label>
                  <label className="check"><input type="checkbox" checked={!!form.valores.activa}
                    onChange={e => set('activa', e.target.checked)} /> Activa</label>

                  <div className="wide fallas">
                    <div className="fallas-h">
                      Fallas posibles de este equipo
                      <em>opcional · si no marcás ninguna, el operador ve todo el catálogo</em>
                    </div>
                    {data.categorias.map(cat => {
                      const causas = data.causas.filter(c => c.categoria_id === cat.id && c.activo);
                      if (!causas.length) return null;
                      return (
                        <div className="fallas-grupo" key={cat.id}>
                          <div className="fallas-cat">{cat.nombre}</div>
                          <div className="fallas-items">
                            {causas.map(c => {
                              const on = (form.valores.causas || []).includes(c.id);
                              return (
                                <label key={c.id} className={`falla ${on ? 'on' : ''}`}>
                                  <input type="checkbox" checked={on} onChange={() => toggleCausa(c.id)} />
                                  {c.descripcion}
                                  {c.es_planificada && <em>plan.</em>}
                                </label>
                              );
                            })}
                            <button type="button" className="falla-add"
                                    onClick={() => setNuevaFalla({ categoria_id: cat.id, descripcion: '' })}>
                              ＋ Nueva
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {form.tipo === 'receta' && (
                <>
                  <label>Código<input id="form-first" value={form.valores.codigo}
                    onChange={e => set('codigo', e.target.value)} placeholder="R-JIB-ALET" /></label>
                  <label>Nombre<input value={form.valores.nombre}
                    onChange={e => set('nombre', e.target.value)} placeholder="Jibia aleta · L4" /></label>

                  <label>Especie
                    <div className="inline">
                      <select value={form.valores.especie_id || ''}
                        onChange={e => set('especie_id', e.target.value ? Number(e.target.value) : null)}>
                        <option value="">—</option>
                        {data.especies.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                      </select>
                      <button className="mini" onClick={() => setNuevo({ tipo: 'especie', codigo: '', nombre: '' })}>＋</button>
                    </div>
                  </label>
                  <label>Producto
                    <div className="inline">
                      <select value={form.valores.producto_id || ''}
                        onChange={e => set('producto_id', e.target.value ? Number(e.target.value) : null)}>
                        <option value="">—</option>
                        {data.productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                      <button className="mini" onClick={() => setNuevo({ tipo: 'producto', codigo: '', nombre: '' })}>＋</button>
                    </div>
                  </label>

                  <label>Línea<select value={form.valores.linea_id || ''}
                    onChange={e => set('linea_id', e.target.value ? Number(e.target.value) : null)}>
                    <option value="">—</option>
                    {data.lineas.map(l => <option key={l.id} value={l.id}>{l.codigo} · {l.nombre}</option>)}
                  </select></label>
                  <label>Toneladas / turno<input type="number" step="0.1" value={form.valores.toneladas_turno || ''}
                    onChange={e => set('toneladas_turno', e.target.value)} /></label>
                  <label>Rendimiento %<input type="number" step="0.1" value={form.valores.rendimiento_pct || ''}
                    onChange={e => set('rendimiento_pct', e.target.value)} /></label>
                  <label>Vigente desde<input type="date" value={form.valores.vigente_desde || ''}
                    onChange={e => set('vigente_desde', e.target.value)} /></label>
                  <label>Vigente hasta<input type="date" value={form.valores.vigente_hasta || ''}
                    onChange={e => set('vigente_hasta', e.target.value)} /></label>
                  <label className="check"><input type="checkbox" checked={!!form.valores.activa}
                    onChange={e => set('activa', e.target.checked)} /> Activa</label>
                  <label className="wide">Notas<input value={form.valores.notas || ''}
                    onChange={e => set('notas', e.target.value)} /></label>

                  <div className="wide dist">
                    <div className="dist-h">Distribución por máquina</div>
                    {!form.valores.linea_id && <p className="set-hint">Elige una línea para ver sus máquinas.</p>}
                    {form.valores.linea_id && maquinasDeLinea.length === 0 && (
                      <p className="set-hint">Esa línea todavía no tiene trama.</p>
                    )}
                    {maquinasDeLinea.map(m => {
                      const actual = (form.valores.distribucion || []).find(d => d.maquina_id === m.maquina_id);
                      return (
                        <div className="dist-row" key={m.maquina_id}>
                          <label className="check">
                            <input type="checkbox" checked={!!actual}
                              onChange={e => toggleMaquinaReceta(m.maquina_id, e.target.checked)} />
                            <span className="pos">{m.posicion}</span>
                            {m.maquina?.nombre_corto}
                          </label>
                          <div className="pct">
                            <input type="number" min="1" max="100" value={actual ? actual.porcentaje : ''}
                              disabled={!actual}
                              onChange={e => setPorcentaje(m.maquina_id, e.target.value)} />
                            <span>%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {form.error && <div className="form-error">{form.error}</div>}

            <div className="form-foot">
              <button className="ghost" onClick={() => setForm(null)}>Cancelar</button>
              <button className="btn-go small" onClick={guardar} disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>

      {nuevaFalla && (
            <div className="form-card mini-card">
              <div className="form-head">
                <h3>Nueva falla</h3>
                <button className="x" onClick={() => setNuevaFalla(null)}>✕</button>
              </div>
              <div className="form-grid">
                <label>Categoría
                  <select value={nuevaFalla.categoria_id}
                          onChange={e => setNuevaFalla({ ...nuevaFalla, categoria_id: Number(e.target.value) })}>
                    {data.categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </label>
                <label>Descripción
                  <input autoFocus value={nuevaFalla.descripcion}
                         onChange={e => setNuevaFalla({ ...nuevaFalla, descripcion: e.target.value })}
                         placeholder="Cinta trabada" />
                </label>
              </div>
              <div className="form-foot">
                <button className="ghost" onClick={() => setNuevaFalla(null)}>Cancelar</button>
                <button className="btn-go small" onClick={crearFalla}>Crear y asignar</button>
              </div>
            </div>
          )}

          {nuevo && (
            <div className="form-card mini-card">
              <div className="form-head">
                <h3>{nuevo.tipo === 'especie' ? 'Nueva especie' : 'Nuevo producto'}</h3>
                <button className="x" onClick={() => setNuevo(null)}>✕</button>
              </div>
              <div className="form-grid">
                <label>Código<input value={nuevo.codigo}
                  onChange={e => setNuevo({ ...nuevo, codigo: e.target.value })} placeholder="JIB" /></label>
                <label>Nombre<input value={nuevo.nombre}
                  onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Jibia" /></label>
              </div>
              <div className="form-foot">
                <button className="ghost" onClick={() => setNuevo(null)}>Cancelar</button>
                <button className="btn-go small" onClick={crearCatalogo}>Crear</button>
              </div>
            </div>
          )}
        </div>
      )}

          {areasEdit && (
        <div className="form-layer">
          <div className="form-card">
            <div className="form-head">
              <h3>Áreas de la planta</h3>
              <button className="x" onClick={() => setAreasEdit(null)}>✕</button>
            </div>

            <div className="areas-list">
              {areasEdit.map((a, i) => (
                <div className="area-row" key={a.id || 'nueva' + i}>
                  <span className="badge sm">{a.codigo || 'nueva'}</span>
                  <input value={a.nombre} placeholder="Nombre del área"
                         onChange={e => setArea(i, 'nombre', e.target.value)} />
                  <input className="ord" type="number" min="0" value={a.orden ?? 0}
                         onChange={e => setArea(i, 'orden', Number(e.target.value))} />
                  <button className="btn-ghost" onClick={() => guardarArea(i)} disabled={!a.nombre.trim()}>
                    {a.id ? 'Guardar' : 'Crear'}
                  </button>
                </div>
              ))}
            </div>

            <button className="wz-add" style={{ marginTop: 12 }}
                    onClick={() => setAreasEdit([...areasEdit, { nombre: '', orden: (areasEdit.at(-1)?.orden ?? 0) + 1 }])}>
              ＋ Nueva área
            </button>
            <p className="set-hint">
              El número es el orden en que aparecen las áreas en el tablero. Un área con equipos no se puede
              borrar: primero mové sus equipos a otra.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
