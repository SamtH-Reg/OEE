import { useEffect, useState } from 'react';
import { api, sesion } from './api';
import Login from './Login';
import App from './App';

// Raíz de la app: si no hay sesión muestra el login (PIN para operadores,
// correo y contraseña para administradores) y si hay, el tablero.

export default function Raiz() {
  const [usuario, setUsuario] = useState(() => sesion.usuario());

  useEffect(() => {
    const cerrar = () => { sesion.borrar(); setUsuario(null); };
    window.addEventListener('sesion-vencida', cerrar);
    if (usuario) {
      // validar la sesión en segundo plano: si no hay red se sigue con lo guardado
      api.me()
        .then(u => { if (u && u.id) { sesion.guardar(null, u); setUsuario(u); } })
        .catch(() => { /* sin red o vencida: el evento se encarga */ });
    }
    return () => window.removeEventListener('sesion-vencida', cerrar);
  }, []);

  if (!usuario) return <Login onEntrar={u => setUsuario(u)} />;
  return <App usuario={usuario} onSalir={() => { sesion.borrar(); setUsuario(null); }} />;
}
