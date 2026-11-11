// Service worker retirado: se autodestruye para que el navegador no siga
// sirviendo una version vieja de la app. El modo offline se reactiva cuando
// se despliegue en la red de planta.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.registration.unregister();
    const clientes = await self.clients.matchAll({ type: 'window' });
    for (const c of clientes) {
      try { c.navigate(c.url); } catch (err) { /* noop */ }
    }
  })());
});

self.addEventListener('fetch', () => {});
