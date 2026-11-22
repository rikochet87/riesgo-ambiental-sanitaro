// Sesión del moderador. No es un endpoint (empieza con "_").
//
// Entrada: la clave ADMIN_CLAVE (variable de Vercel). Si es correcta se
// entrega una cookie firmada, válida 8 horas, que el navegador manda solo a
// /api/admin, no la puede leer JavaScript (HttpOnly) y no viaja desde otros
// sitios (SameSite=Strict).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { json } from './_http.js';

const COOKIE = 'admin_sesion';
const DURACION_S = 8 * 60 * 60;
export const CLAVE_MINIMA = 12;

// La firma mezcla la clave del panel con la cadena de la base, que trae una
// contraseña larga y al azar: aunque ADMIN_CLAVE fuera floja, la firma no se
// puede adivinar. Cambiar ADMIN_CLAVE cierra todas las sesiones abiertas.
function llaveDeFirma() {
  return createHash('sha256')
    .update(`sesion-admin\0${process.env.ADMIN_CLAVE}\0${process.env.DATABASE_URL || ''}`)
    .digest();
}

const firmar = (vence) => createHmac('sha256', llaveDeFirma()).update(String(vence)).digest('base64url');

function iguales(a, b) {
  // Comparación en tiempo constante (sobre los hash, que miden lo mismo)
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function claveConfigurada() {
  return (process.env.ADMIN_CLAVE || '').length >= CLAVE_MINIMA;
}

export const claveCorrecta = (intento) => claveConfigurada() && iguales(intento, process.env.ADMIN_CLAVE);

export function cookieDeSesion() {
  const vence = Math.floor(Date.now() / 1000) + DURACION_S;
  return `${COOKIE}=${vence}.${firmar(vence)}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${DURACION_S}`;
}

export const cookieVencida = () =>
  `${COOKIE}=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

function sesionValida(request) {
  if (!claveConfigurada()) return false;
  const cookies = request.headers.get('cookie') || '';
  const valor = cookies.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!valor) return false;
  const [vence, firma] = valor.split('.');
  if (!/^\d+$/.test(vence || '') || !firma) return false;
  if (Number(vence) < Date.now() / 1000) return false;
  return iguales(firma, firmar(vence));
}

// Los cambios tienen que venir de esta misma página: mismo origen y JSON
// (un formulario de otro sitio no puede mandar JSON sin pasar por CORS).
function mismoOrigen(request) {
  const origen = request.headers.get('origin');
  if (!origen) return true; // sin Origin: lo cubren SameSite=Strict y el JSON
  try { return new URL(origen).host === new URL(request.url).host; } catch { return false; }
}

// Devuelve una respuesta de error, o null si el pedido puede seguir
export function controlar(request, { cambia = false } = {}) {
  if (!claveConfigurada()) {
    return json({ code: 'ADMIN_SIN_CONFIG',
                  message: `Falta configurar ADMIN_CLAVE en Vercel (mínimo ${CLAVE_MINIMA} caracteres).` }, 503);
  }
  if (cambia) {
    if (!mismoOrigen(request)) return json({ code: 'ORIGEN', message: 'Pedido desde otro sitio.' }, 403);
    const tipo = (request.headers.get('content-type') || '').toLowerCase();
    if (!tipo.startsWith('application/json')) {
      return json({ code: 'FORMATO', message: 'Se esperaba JSON.' }, 415);
    }
  }
  if (!sesionValida(request)) return json({ code: 'SIN_SESION', message: 'Tenés que entrar de nuevo.' }, 401);
  return null;
}

export async function leerJSON(request, maximo = 4000) {
  const texto = await request.text();
  if (texto.length > maximo) return null;
  try {
    const datos = JSON.parse(texto);
    return datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : null;
  } catch {
    return null;
  }
}
