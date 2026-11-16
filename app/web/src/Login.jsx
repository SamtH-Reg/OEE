import { useState } from 'react';
import { api, sesion } from './api';

// Entrada a la app. En la tablet el operador entra con PIN (teclado grande);
// el administrador y los supervisores con correo y contraseña.

export default function Login({ onEntrar }) {
  const [modo, setModo] = useState('pin');        // 'pin' | 'clave'
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function entrarConPin(valor) {
    if (valor.length < 4) return;
    setCargando(true);
    setError(null);
    try {
      const r = await api.loginPin(valor);
      sesion.guardar(r.token, r.usuario);
      onEntrar(r.usuario);
    } catch (e) {
      setError(e.message);
      setPin('');
    } finally {
      setCargando(false);
    }
  }

  async function entrarConClave(e) {
    e?.preventDefault();
    if (!email.trim() || !pass) return;
    setCargando(true);
    setError(null);
    try {
      const r = await api.login(email.trim(), pass);
      sesion.guardar(r.token, r.usuario);
      onEntrar(r.usuario);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  function tecla(t) {
    if (t === 'borrar') { setPin(p => p.slice(0, -1)); return; }
    if (t === 'ok') { entrarConPin(pin); return; }
    if (pin.length >= 6) return;
    const nuevo = pin + t;
    setPin(nuevo);
    if (nuevo.length === 6) entrarConPin(nuevo);
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-marca">
          <div className="mark" />
          <div>
            <b>Tablero de Planta</b>
            <span>Planta de Proceso Chacabuco</span>
          </div>
        </div>

        <div className="login-tabs">
          <button className={modo === 'pin' ? 'on' : ''} onClick={() => { setModo('pin'); setError(null); }}>
            Usuario · PIN
          </button>
          <button className={modo === 'clave' ? 'on' : ''} onClick={() => { setModo('clave'); setError(null); }}>
            Administrador
          </button>
        </div>

        {modo === 'pin' ? (
          <>
            <p className="login-hint">Ingresá tu PIN de 4 a 6 dígitos</p>
            <div className="login-pin">
              {[0, 1, 2, 3, 4, 5].map(i => (
                <span key={i} className={pin.length > i ? 'on' : ''} />
              ))}
            </div>
            <div className="login-teclado">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(t => (
                <button key={t} onClick={() => tecla(t)} disabled={cargando}>{t}</button>
              ))}
              <button className="tenue" onClick={() => tecla('borrar')} disabled={cargando || !pin}>⌫</button>
              <button onClick={() => tecla('0')} disabled={cargando}>0</button>
              <button className="ok" onClick={() => tecla('ok')} disabled={cargando || pin.length < 4}>
                {cargando ? '…' : 'OK'}
              </button>
            </div>
          </>
        ) : (
          <form className="login-form" onSubmit={entrarConClave}>
            <label>Correo
              <input type="email" value={email} autoComplete="username"
                     onChange={e => setEmail(e.target.value)} placeholder="Correo" />
            </label>
            <label>Contraseña
              <input type="password" value={pass} autoComplete="current-password"
                     onChange={e => setPass(e.target.value)} placeholder="••••••••" />
            </label>
            <button className="btn-go" type="submit" disabled={cargando || !email || !pass}>
              {cargando ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        )}

        {error && <div className="login-error">{error}</div>}

        <div className="login-pie">
          Sin conexión también se registra: los datos se envían al volver la red.
        </div>
      </div>
    </div>
  );
}
