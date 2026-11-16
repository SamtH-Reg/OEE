// Service worker del tablero desplegado (Vercel). En local no se registra.
// Estrategia: network-first para todo lo propio (una versión nueva se ve al
// instante) y caché como red de seguridad cuando no hay conexión.
// La API no se cachea acá: los datos viven en IndexedDB y en la cola de paradas.

const CACHE = 'tablero-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icono.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;   // la API va siempre a la red

  e.respondWith((async () => {
    try {
      const red = await fetch(req);
      if (red && red.ok) {
        const c = await caches.open(CACHE);
        c.put(req, red.clone()).catch(() => {});
      }
      return red;
    } catch (err) {
      const guardado = await caches.match(req);
      if (guardado) return guardado;
      if (req.mode === 'navigate') {
        const shell = await caches.match('/index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
