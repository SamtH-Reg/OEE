const TOKEN = 'demo';

async function req(path, opciones = {}) {
  // el content-type solo va si hay cuerpo: Fastify rechaza un DELETE con
  // content-type json y body vacío
  const headers = { 'x-app-token': TOKEN, ...(opciones.headers || {}) };
  if (opciones.body) headers['content-type'] = 'application/json';
  const res = await fetch(path, { ...opciones, headers });
  const texto = await res.text();
  const data = texto ? JSON.parse(texto) : null;
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

export const api = {
  catalogo: () => req('/api/catalogo'),
  tablero: () => req('/api/tablero'),
  lineas: () => req('/api/lineas'),
  guardarTrama: (lineaId, maquinas) =>
    req(`/api/lineas/${lineaId}/trama`, { method: 'PUT', body: JSON.stringify({ maquinas }) }),
  sync: (body) => req('/api/sync', { method: 'POST', body: JSON.stringify(body) }),
  settings: () => req('/api/settings'),
  crearLinea: (b) => req('/api/lineas', { method: 'POST', body: JSON.stringify(b) }),
  editarLinea: (id, b) => req(`/api/lineas/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  crearMaquina: (b) => req('/api/maquinas', { method: 'POST', body: JSON.stringify(b) }),
  editarMaquina: (id, b) => req(`/api/maquinas/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  crearEspecie: (b) => req('/api/especies', { method: 'POST', body: JSON.stringify(b) }),
  crearProducto: (b) => req('/api/productos', { method: 'POST', body: JSON.stringify(b) }),
  crearCausa: (b) => req('/api/causas', { method: 'POST', body: JSON.stringify(b) }),
  crearArea: (b) => req('/api/areas', { method: 'POST', body: JSON.stringify(b) }),
  editarArea: (id, b) => req(`/api/areas/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  eliminarMaquina: (id) => req(`/api/maquinas/${id}`, { method: 'DELETE' }),
  crearReceta: (b) => req('/api/recetas', { method: 'POST', body: JSON.stringify(b) }),
  editarReceta: (id, b) => req(`/api/recetas/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  demo: () => req('/api/demo'),
  eliminarDemo: () => req('/api/demo/eliminar', { method: 'POST', body: JSON.stringify({ confirmar: true }) }),
  historial: (q = '') => req('/api/historial' + q)
};
