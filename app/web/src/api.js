const TOKEN = 'demo';

async function req(path, opciones = {}) {
  const res = await fetch(path, {
    ...opciones,
    headers: {
      'content-type': 'application/json',
      'x-app-token': TOKEN,
      ...(opciones.headers || {})
    }
  });
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
  historial: (q = '') => req('/api/historial' + q)
};
