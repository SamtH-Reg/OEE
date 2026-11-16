import { useEffect, useState } from 'react';
import { api } from './api';

// Alta y edición de usuarios: los operadores entran con PIN, los supervisores y
// administradores con correo y contraseña. Sólo lo ve el administrador.

const ROLES_UI = [
  { id: 'operador', nombre: 'Operador de máquina (PIN)' },
  { id: 'supervisor', nombre: 'Supervisor (correo + clave)' },
  { id: 'admin', nombre: 'Administrador (correo + clave)' }
];

const vacio = { nombre: '', email: '', rol: 'operador', pin: '', pass: '' };

export default function Usuarios() {
  const [lista, setLista] = useState([]);
  const [form, setForm] = useState(null);       // { id?, ...vacio }
  const [clave, setClave] = useState(null);     // { user, pin, pass }
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    try {
      const r = await api.usuarios();
      setLista(r.usuarios || []);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => { cargar(); }, []);

  async function guardar() {
    if (!form) return;
    setGuardando(true);
    setError(null);
    try {
      if (form.id) {
        await api.editarUsuario(form.id, { nombre: form.nombre, email: form.email, rol: form.rol });
      } else {
        await api.crearUsuario({
          nombre: form.nombre,
          email: form.email || null,
          rol: form.rol,
          pin: form.rol === 'operador' ? form.pin : null,
          pass: form.rol === 'operador' ? null : form.pass
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
              <select value={form.rol} onChange={e => setForm({ ...form, rol: e.target.value })}>
                {ROLES_UI.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </select>
            </label>
            <label>Correo {form.rol === 'operador' && <em>(opcional)</em>}
              <input value={form.email} placeholder="nombre@friosur.cl"
                     onChange={e => setForm({ ...form, email: e.target.value })} />
            </label>
            {form.rol === 'operador' ? (
              <label>PIN (4 a 6 dígitos)
                <input value={form.pin} inputMode="numeric" maxLength={6} placeholder="0000"
                       onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} />
              </label>
            ) : (
              <label>Contraseña
                <input type="password" value={form.pass} placeholder="••••••••"
                       onChange={e => setForm({ ...form, pass: e.target.value })} />
              </label>
            )}
          </div>
          <div className="usu-acciones">
            <button className="ghost" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn-go small" onClick={guardar}
                    disabled={guardando || !form.nombre.trim()}>Guardar</button>
          </div>
        </div>
      )}

      {clave && (
        <div className="usu-form">
          <b>Clave de {clave.user.nombre}</b>
          <div className="usu-grid">
            {clave.user.rol === 'operador' ? (
              <label>PIN nuevo
                <input value={clave.pin} inputMode="numeric" maxLength={6} autoFocus placeholder="0000"
                       onChange={e => setClave({ ...clave, pin: e.target.value.replace(/\D/g, '') })} />
              </label>
            ) : (
              <label>Contraseña nueva
                <input type="password" value={clave.pass} autoFocus placeholder="••••••••"
                       onChange={e => setClave({ ...clave, pass: e.target.value })} />
              </label>
            )}
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
                {ROLES_UI.find(r => r.id === u.rol)?.nombre || u.rol}
                {u.email ? ` · ${u.email}` : ''}
                {u.rol === 'operador' ? (u.tiene_pin ? ' · con PIN' : ' · sin PIN') : ''}
                {u.activo ? '' : ' · inactivo'}
              </small>
            </div>
            <button className="btn-ghost" onClick={() => { setForm({ ...u, pin: '', pass: '' }); }}>
              Editar
            </button>
            <button className="btn-ghost"
                    onClick={() => setClave({ user: u, pin: '', pass: '' })}>
              {u.rol === 'operador' ? 'PIN' : 'Clave'}
            </button>
            <button className="btn-ghost" onClick={() => alternarActivo(u)}>
              {u.activo ? 'Desactivar' : 'Activar'}
            </button>
          </div>
        ))}
        {!lista.length && <p className="set-hint">Todavía no hay usuarios.</p>}
      </div>

      <p className="set-hint">
        Los operadores entran a la tablet con su PIN; los supervisores y el administrador, con correo y
        contraseña. Un operador sólo registra paradas: no arma el turno ni edita catálogos.
      </p>
    </>
  );
}
