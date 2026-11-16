import app from '../server/index.js';

// Función de Vercel: todo /api/* entra acá y la atiende Fastify.
// Los archivos estáticos los sirve la plataforma (web/dist).

export default async function handler(req, res) {
  await app.ready();
  app.server.emit('request', req, res);
}
