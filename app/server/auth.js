import crypto from 'node:crypto';

// Claves y PIN con scrypt (sin dependencias nativas, corre en Vercel).
// El token es un JWT HS256 firmado con AUTH_SECRET.

const SECRETO = process.env.AUTH_SECRET || 'clave-de-desarrollo-cambiar-en-produccion';
export const DIAS_TOKEN = 30;

export const ROLES = { operador: 1, supervisor: 2, admin: 3 };

export function hashSecreto(txt) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(txt), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verificarSecreto(txt, guardado) {
  if (!guardado || !String(guardado).includes(':')) return false;
  const [salt, hash] = String(guardado).split(':');
  try {
    const prueba = crypto.scryptSync(String(txt), salt, 32).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(prueba, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function firmarToken(datos, dias = DIAS_TOKEN) {
  const cabecera = b64({ alg: 'HS256', typ: 'JWT' });
  const cuerpo = b64({ ...datos, exp: Date.now() + dias * 86400000 });
  const firma = crypto.createHmac('sha256', SECRETO).update(`${cabecera}.${cuerpo}`).digest('base64url');
  return `${cabecera}.${cuerpo}.${firma}`;
}

export function verificarToken(token) {
  if (!token || String(token).split('.').length !== 3) return null;
  const [cabecera, cuerpo, firma] = String(token).split('.');
  const esperada = crypto.createHmac('sha256', SECRETO).update(`${cabecera}.${cuerpo}`).digest('base64url');
  if (firma.length !== esperada.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  try {
    const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
    if (!datos.exp || datos.exp < Date.now()) return null;
    return datos;
  } catch {
    return null;
  }
}

export const pinValido = (pin) => /^\d{4,6}$/.test(String(pin || ''));
