// POST   /api/admin/entrar  {clave}  → abre la sesión del moderador
// DELETE /api/admin/entrar          → la cierra
import { comoPublico } from '../_db.js';
import { json, errorDeBase } from '../_http.js';
import { origenDe } from '../_origen.js';
import { claveConfigurada, claveCorrecta, cookieDeSesion, cookieVencida, leerJSON, CLAVE_MINIMA } from '../_admin.js';

export async function POST(request) {
  if (!claveConfigurada()) {
    return json({ code: 'ADMIN_SIN_CONFIG',
                  message: `Falta configurar ADMIN_CLAVE en Vercel (mínimo ${CLAVE_MINIMA} caracteres).` }, 503);
  }
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return json({ code: 'FORMATO', message: 'Se esperaba JSON.' }, 415);
  }
  const datos = await leerJSON(request, 1000);
  const intento = typeof datos?.clave === 'string' ? datos.clave : '';
  const ok = claveCorrecta(intento);

  // La base anota el intento y decide: con 10 fallidos en 15 minutos desde
  // la misma conexión no la deja entrar, aunque esta vez la clave sea la
  // correcta. Otra conexión (la del moderador) sigue pudiendo.
  let permitido;
  try {
    const [[fila]] = await comoPublico([['select public.admin_intento($1, $2) as permitido', [ok, origenDe(request)]]]);
    permitido = fila.permitido;
  } catch (err) {
    return errorDeBase(err);
  }

  if (ok && !permitido) {
    return json({ code: 'BLOQUEADO', message: 'Demasiados intentos fallidos. Probá en 15 minutos.' }, 429);
  }
  if (!ok) {
    return json({ code: 'CLAVE', message: 'La clave no es correcta.' }, 401);
  }
  return json({ ok: true }, 200, { 'Set-Cookie': cookieDeSesion() });
}

export function DELETE() {
  return json({ ok: true }, 200, { 'Set-Cookie': cookieVencida() });
}
