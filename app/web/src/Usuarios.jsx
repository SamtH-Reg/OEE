import { useEffect, useState } from 'react';
import { api } from './api';

// Alta y edición de usuarios: los operadores entran con PIN, los supervisores y
// administradores con correo y contraseña. Sólo lo ve el administrador.

const vacio = { nombre: '', email: '', rol: 'operador', pin: '', pass: '' };

// Los roles viven en la base: se pueden crear nuevos y cada uno toma un nivel
// (1 operador, 2 supervisor, 3 administrador).
const NIVELES = [
  { n: 1, texto: 'Nivel 1 · operador (registra paradas)' },
  { n: 2, texto: 'Nivel 2 · supervisor (arma el turno y ve el análisis)' },
  { n: 3, texto: 'Nivel 3 · administrador (todo, incluidos catálogos)' }
];

export default function Usuarios() {
  const [lista, setLista] = useState([]);
  const [roles, setRoles] = useState([]);
  const [nuevoRol, setNuevoRol] = useState(null);  // {nombre, nivel}
  const [form, setForm] = useState(null);       // { id?, ...vacio }
  const [clave, setClave] = useState(null);     // { user, pin, pass }
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    try {
      const [u, r] = await Promise.all([api.usuarios(), api.roles()]);
      setLista(u.usuarios || []);
      setRoles(r.roles || []);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => { cargar(); }, []);

  const nombreRol = (codigo) => roles.find(r => r.codigo === codigo)?.nombre || codigo;
  const nivelDe = (codigo) => Number(roles.find(r => r.codigo === codigo)?.nivel) || 1;

  async function crearRol() {
    if (!nuevoRol || !nuevoRol.nombre.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      const creado = await api.crearRol({ nombre: nuevoRol.nombre.trim(), nivel: Number(nuevoRol.nivel) });
      setNuevoRol(null);
      await cargar();
      if (form) setForm({ ...form, rol: creado.codigo });
      setAviso(`Rol «${creado.nombre}» creado`);
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function guardar() {
    if (!form) return;
    setGuardando(true);
    setError(null);
    try {
      if (form.id) {
        await api.editarUsuario(form.id, { nombre: form.nombre, email: form.email, rol: form.rol });
        if (form.pin || form.pass) {
          await api.claveUsuario(form.id, { pin: form.pin || null, pass: form.pass || null });
        }
      } else {
        const esAdmin = nivelDe(form.rol) >= 3;
        await api.crearUsuario({
          nombre: form.nombre,
          email: esAdmin ? (form.email || null) : null,
          rol: form.rol,
          pin: esAdmin ? null : form.pin,
          pass: esAdmin ? form.pass : null
        });
      }
      setForm(null);
      setAviso('Usuario guardado');
      await cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function alternarActivo(u) {
    try {
      await api.editarUsuario(u.id, { activo: !u.activo });
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  async function guardarClave() {
    if (!clave) return;
    setGuardando(true);
    try {
      await api.claveUsuario(clave.user.id, {
        pin: clave.pin || null,
        pass: clave.pass || null
      });
      setClave(null);
      setAviso('Clave actualizada');
      await cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <div className="set-bar">
        <span className="set-count">{lista.length} usuarios</span>
        <button className="btn-add" onClick={() => { setForm({ ...vacio }); setAviso(null); }}>
          ＋ Nuevo usuario
        </button>
      </div>

      {error && <div className="aviso error">{error}</div>}
      {aviso && <div className="aviso">{aviso}</div>}

      {form && (
        <div className="usu-form">
          <div className="usu-grid">
            <label>Nombre
              <input value={form.nombre} autoFocus placeholder="Nombre y apellido"
                     onChange={e => setForm({ ...form, nombre: e.target.value })} />
            </label>
            <label>Rol
              <select value={form.rol}
                      onChange={e => {
                        if (e.target.value === '__nuevo') { setNuevoRol({ nombre: '', nivel: 1 }); return; }
                        setForm({ ...form, rol: e.target.value });
                      }}>
                {roles.map(r => <option key={r.codigo} value={r.codigo}>{r.nombre} · nivel {r.nivel}</option>)}
                <option value="__nuevo">＋ Agregar nuevo rol…</option>
              </select>
            </label>
            {nivelDe(form.rol) >= 3 ? (
              <>
                <label>Correo
                  <input value={form.email} placeholder="nombre@friosur.cl"
                         onChange={e => setForm({ ...form, email: e.target.value })} />
                </label>
                <label>Contraseña
                  <input type="password" value={form.pass} placeholder="••••••••"
                         onChange={e => setForm({ ...form, pass: e.target.value })} />
                </label>
              </>
            ) : (
              <label>PIN para la tablet <em>(4 a 6 dígitos)</em>
                <input value={form.pin} inputMode="numeric" maxLength={6} placeholder="0000"
                       onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} />
              </label>
            )}
          </div>
          <div className="usu-acciones">
            <button className="ghost" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn-go small" onClick={guardar}
                    disabled={guardando || !form.nombre.trim()
                      || (!form.id && nivelDe(form.rol) >= 3 && !(form.pass && form.email))
                      || (!form.id && nivelDe(form.rol) < 3 && form.pin.length < 4)}>
              Guardar
            </button>
          </div>
        </div>
      )}

      {nuevoRol && (
        <div className="usu-form">
          <b>Nuevo rol</b>
          <div className="usu-grid">
            <label>Nombre del rol
              <input value={nuevoRol.nombre} autoFocus placeholder="Jefe de turno, Calidad…"
                     onChange={e => setNuevoRol({ ...nuevoRol, nombre: e.target.value })} />
            </label>
            <label>Nivel
              <select value={nuevoRol.nivel}
                      onChange={e => setNuevoRol({ ...nuevoRol, nivel: Number(e.target.value) })}>
                {NIVELES.map(n => <option key={n.n} value={n.n}>{n.texto}</option>)}
              </select>
            </label>
          </div>
          <div className="usu-acciones">
            <button className="ghost" onClick={() => setNuevoRol(null)}>Cancelar</button>
            <button className="btn-go small" onClick={crearRol}
                    disabled={guardando || !nuevoRol.nombre.trim()}>Crear rol</button>
          </div>
        </div>
      )}

      {clave && (
        <div className="usu-form">
          <b>Clave de {clave.user.nombre}</b>
          <div className="usu-grid">
            <label>PIN nuevo <em>(tablet)</em>
              <input value={clave.pin} inputMode="numeric" maxLength={6} autoFocus placeholder="0000"
                     onChange={e => setClave({ ...clave, pin: e.target.value.replace(/\D/g, '') })} />
            </label>
            <label>Contraseña nueva <em>(correo)</em>
              <input type="password" value={clave.pass} placeholder="••••••••"
                     onChange={e => setClave({ ...clave, pass: e.target.value })} />
            </label>
          </div>
          <div className="usu-acciones">
            <button className="ghost" onClick={() => setClave(null)}>Cancelar</button>
            <button className="btn-go small" onClick={guardarClave} disabled={guardando}>Guardar</button>
          </div>
        </div>
      )}

      <div className="set-list">
        {lista.map(u => (
          <div className={`set-row ${u.activo ? '' : 'off'}`} key={u.id}>
            <div className="grow">
              <b>{u.nombre}</b>
              <small>
                {nombreRol(u.rol)}
                {u.email ? ` · ${u.email}` : ''}
                {u.tiene_pin ? ' · con PIN' : ' · sin PIN'}
                {u.activo ? '' : ' · inactivo'}
              </small>
            </div>
            <button className="btn-ghost" onClick={() => { setForm({ ...u, pin: '', pass: '' }); }}>
              Editar
            </button>
            <button className="btn-ghost"
                    onClick={() => setClave({ user: u, pin: '', pass: '' })}>
              Clave
            </button>
            <button className="btn-ghost" onClick={() => alternarActivo(u)}>
              {u.activo ? 'Archivar' : 'Restaurar'}
            </button>
          </div>
        ))}
        {!lista.length && <p className="set-hint">Todavía no hay usuarios.</p>}
      </div>

      <p className="set-hint">
        Todos los usuarios entran a la tablet con su PIN; sólo el administrador (nivel 3) entra además con
        correo y contraseña. El nivel decide qué puede hacer: 1 registra paradas, 2 arma el turno y ve el
        análisis, 3 además edita catálogos y usuarios.
      </p>
    </>
  );
}
