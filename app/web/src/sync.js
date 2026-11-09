import { db, dispositivoId } from './db';
import { api } from './api';

let corriendo = false;

// Envía la cola local. Devuelve cuántos eventos quedaron pendientes.
export async function sincronizar(dispositivo_id = dispositivoId()) {
  if (corriendo) return null;
  corriendo = true;
  try {
    const eventos = await db.outbox.orderBy('id').toArray();
    if (!eventos.length) return null;

    const { resultados } = await api.sync({ eventos, dispositivo_id });

    for (const r of resultados) {
      if (!r.ok) continue;
      const ev = eventos.find(e => e.id === r.id);
      // un cierre lleva el mismo uuid que su apertura: se borra por id
      if (ev) await db.outbox.delete(ev.id);
    }
    return await db.outbox.count();
  } finally {
    corriendo = false;
  }
}

// Ciclo de sincronización: al volver la red, al cambiar de pestaña y cada 12 s.
// alCambiar(pendientes, hayRed)
export async function arrancarSync(alCambiar) {
  const ciclo = async () => {
    if (!navigator.onLine) {
      alCambiar(await db.outbox.count(), false);
      return;
    }
    try {
      const p = await sincronizar();
      if (p !== null) {
        alCambiar(p, true);
        return;
      }
      // sin cola: una llamada liviana sirve para saber si el servidor responde
      await api.tablero();
      alCambiar(await db.outbox.count(), true);
    } catch (e) {
      // sin red o servidor caído: la cola queda intacta
      alCambiar(await db.outbox.count(), false);
    }
  };

  const t = setInterval(ciclo, 12000);
  window.addEventListener('online', ciclo);
  window.addEventListener('offline', ciclo);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ciclo(); });
  setTimeout(ciclo, 1200);

  return () => {
    clearInterval(t);
    window.removeEventListener('online', ciclo);
    window.removeEventListener('offline', ciclo);
  };
}
