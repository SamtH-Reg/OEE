import Dexie from 'dexie';

// Base local de la tablet. Es la fuente de verdad mientras no hay red.
export const db = new Dexie('paradas-planta');
db.version(1).stores({
  catalogo: 'id',                 // un solo registro: 'actual'
  maquinas: 'id, area_id, estado',
  outbox: '++id, uuid, tipo'      // cola de eventos pendientes
});

export async function guardarCatalogo(c) {
  await db.catalogo.put({ id: 'actual', ts: Date.now(), ...c });
}

export async function leerCatalogo() {
  return db.catalogo.get('actual');
}

// Último tablero y tramas vistos con red: permite abrir la app sin conexión.
export async function guardarTablero(t) {
  await db.catalogo.put({ id: 'tablero', ts: Date.now(), ...t });
}

export async function leerTablero() {
  return db.catalogo.get('tablero');
}

export async function guardarMaquinas(lista) {
  await db.maquinas.bulkPut(lista);
}

export async function leerMaquinas() {
  return db.maquinas.toArray();
}

export async function encolar(evento) {
  return db.outbox.add({ ...evento, creado_en: Date.now(), intentos: 0 });
}

export async function pendientes() {
  return db.outbox.count();
}

export async function deshacer(eventoId) {
  await db.outbox.delete(eventoId);
}

// Identificador estable de esta tablet (sobrevive a recargas).
export function dispositivoId() {
  let id = localStorage.getItem('dispositivo');
  if (!id) {
    id = 'TAB-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    localStorage.setItem('dispositivo', id);
  }
  return id;
}
