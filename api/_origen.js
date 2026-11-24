// De dónde viene un pedido, sin guardar la IP. No es un endpoint (empieza con "_").
//
// Los topes por origen (reportes por hora, fotos, intentos de entrar al panel)
// necesitan distinguir conexiones, pero el proyecto no guarda quién reporta.
// Por eso a la base no llega la IP sino un código: HMAC de la IP con una llave
// secreta y la fecha del día. Sin la llave no se puede volver a la IP, y el
// código cambia cada día, así que tampoco se puede seguir a nadie en el tiempo.
//
// En Vercel, x-forwarded-for la escribe la propia plataforma con la IP del
// visitante (la que mande el navegador se descarta), así que no se puede falsificar.
import { createHash, createHmac } from 'node:crypto';

// IPv6: una misma conexión suele tener millones de direcciones (/64), así que
// se cuenta por el prefijo /64 y no por la dirección completa.
export function normalizarIP(ip) {
  const limpia = String(ip || '').trim().replace(/^\[|\]$/g, '').split('%')[0];
  if (!limpia.includes(':')) return limpia;               // IPv4
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(limpia)) return limpia.slice(7); // IPv4 dentro de IPv6
  const [izq, der = ''] = limpia.toLowerCase().split('::');
  const a = izq ? izq.split(':') : [];
  const b = limpia.includes('::') && der ? der.split(':') : [];
  const grupos = limpia.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
  return grupos.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

export function ipDe(request) {
  const h = request.headers;
  const ip = (h.get('x-forwarded-for') || '').split(',')[0] || h.get('x-real-ip') || '';
  return normalizarIP(ip);
}

const llave = () => createHash('sha256').update(`origen\0${process.env.DATABASE_URL || ''}`).digest();

// Código del origen, o null si no se sabe (pruebas locales): la base los cuenta juntos
export function origenDe(request, fecha = new Date()) {
  const ip = ipDe(request);
  if (!ip) return null;
  const dia = fecha.toISOString().slice(0, 10);
  return createHmac('sha256', llave()).update(`${dia}\0${ip}`).digest('base64url').slice(0, 22);
}
