// Cliente de la API. La sesión vive en localStorage: token (JWT) + usuario.
// Los operadores entran con PIN y el administrador con correo y contraseña.

const CLAVE_TOKEN = 'paradas_token';
const CLAVE_USUARIO = 'paradas_usuario';

export const ROLES = { operador: 1, supervisor: 2, admin: 3 };

export const sesion = {
  token: () => localStorage.getItem(CLAVE_TOKEN),
  usuario: () => {
    try { return JSON.parse(localStorage.getItem(CLAVE_USUARIO) || 'null'); } catch { return null; }
  },
  guardar: (token, usuario) => {
    if (token) localStorage.setItem(CLAVE_TOKEN, token);
    if (usuario) localStorage.setItem(CLAVE_USUARIO, JSON.stringify(usuario));
  },
  borrar: () => {
    localStorage.removeItem(CLAVE_TOKEN);
    localStorage.removeItem(CLAVE_USUARIO);
  },
  puede: (rol) => {
    const u = sesion.usuario();
    return (ROLES[u?.rol] || 0) >= (ROLES[rol] || 0);
  }
};

async function req(path, opciones = {}) {
  // el content-type solo va si hay cuerpo: Fastify rechaza un DELETE con
  // content-type json y body vacío
  const headers = { ...(opciones.headers || {}) };
  const token = sesion.token();
  if (token) headers.authorization = `Bearer ${token}`;
  if (opciones.body) headers['content-type'] = 'application/json';
  const res = await fetch(path, { ...opciones, headers });
  const texto = await res.text();
  const data = texto ? JSON.parse(texto) : null;
  if (res.status === 401) window.dispatchEvent(new CustomEvent('sesion-vencida'));
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

export const api = {
  // --- sesión y usuarios ---
  login: (email, pass) => req('/api/login', { method: 'POST', body: JSON.stringify({ email, pass }) }),
  loginPin: (pin) => req('/api/login-pin', { method: 'POST', body: JSON.stringify({ pin }) }),
  me: () => req('/api/me'),
  usuarios: () => req('/api/usuarios'),
  crearUsuario: (b) => req('/api/usuarios', { method: 'POST', body: JSON.stringify(b) }),
  editarUsuario: (id, b) => req(`/api/usuarios/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  claveUsuario: (id, b) => req(`/api/usuarios/${id}/clave`, { method: 'POST', body: JSON.stringify(b) }),

  catalogo: () => req('/api/catalogo'),
  tablero: () => req('/api/tablero'),
  lineas: () => req('/api/lineas'),
  guardarTrama: (lineaId, maquinas, conexiones) =>
    req(`/api/lineas/${lineaId}/trama`, {
      method: 'PUT',
      body: JSON.stringify({ maquinas, conexiones: conexiones || [] })
    }),
  moverEquipo: (lineaId, b) =>
    req(`/api/lineas/${lineaId}/mover-equipo`, { method: 'POST', body: JSON.stringify(b) }),
  sync: (body) => req('/api/sync', { method: 'POST', body: JSON.stringify(body) }),
  settings: () => req('/api/settings'),
  crearLinea: (b) => req('/api/lineas', { method: 'POST', body: JSON.stringify(b) }),
  editarLinea: (id, b) => req(`/api/lineas/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  copiarLinea: (id, b) => req(`/api/lineas/${id}/copiar`, { method: 'POST', body: JSON.stringify(b) }),
  eliminarLinea: (id) => req(`/api/lineas/${id}`, { method: 'DELETE' }),
  crearMaquina: (b) => req('/api/maquinas', { method: 'POST', body: JSON.stringify(b) }),
  editarMaquina: (id, b) => req(`/api/maquinas/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  crearEspecie: (b) => req('/api/especies', { method: 'POST', body: JSON.stringify(b) }),
  crearProducto: (b) => req('/api/productos', { method: 'POST', body: JSON.stringify(b) }),
  crearCausa: (b) => req('/api/causas', { method: 'POST', body: JSON.stringify(b) }),
  editarCausa: (id, b) => req(`/api/causas/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  eliminarCausa: (id) => req(`/api/causas/${id}`, { method: 'DELETE' }),
  crearArea: (b) => req('/api/areas', { method: 'POST', body: JSON.stringify(b) }),
  editarArea: (id, b) => req(`/api/areas/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  eliminarMaquina: (id) => req(`/api/maquinas/${id}`, { method: 'DELETE' }),
  copiarMaquina: (id, b) => req(`/api/maquinas/${id}/copiar`, { method: 'POST', body: JSON.stringify(b) }),
  crearReceta: (b) => req('/api/recetas', { method: 'POST', body: JSON.stringify(b) }),
  editarReceta: (id, b) => req(`/api/recetas/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  guardarEtapas: (id, etapas) => req(`/api/recetas/${id}/etapas`, { method: 'PUT', body: JSON.stringify({ etapas }) }),
  proceso: (id) => req(`/api/recetas/${id}/proceso`),
  procesos: () => req('/api/procesos'),
  monitor: () => req('/api/monitor'),
  demo: () => req('/api/demo'),
  eliminarDemo: () => req('/api/demo/eliminar', { method: 'POST', body: JSON.stringify({ confirmar: true }) }),
  setProcesoTurno: (turnoId, procesoId) =>
    req(`/api/turnos/${turnoId}/proceso`, { method: 'PATCH', body: JSON.stringify({ proceso_id: procesoId }) }),
  cerrarTurno: () => req('/api/turnos/cerrar', { method: 'POST', body: JSON.stringify({}) }),
  reabrirTurno: () => req('/api/turnos/reabrir', { method: 'POST', body: JSON.stringify({}) }),
  ajustarCorte: (b) => req('/api/turnos/corte', { method: 'PATCH', body: JSON.stringify(b) }),
  analisis: (p = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v) qs.set(k, v);
    return req('/api/analisis' + (qs.toString() ? '?' + qs.toString() : ''));
  },
  accionParada: (id, b) => req(`/api/paradas/${id}/acciones`, { method: 'POST', body: JSON.stringify(b) }),
  quitarSimulacion: () => req('/api/simulacion', { method: 'DELETE' }),
  historial: (q = '') => req('/api/historial' + q)
};
