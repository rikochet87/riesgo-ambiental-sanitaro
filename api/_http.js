// Respuestas y errores comunes a todas las funciones.

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function json(cuerpo, estado = 200, cabeceras = {}) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...cabeceras,
    },
  });
}

export const malPedido = (mensaje) => json({ code: 'FORMATO', message: mensaje }, 400);

// Errores que la base levanta a propósito. Los P000x traen un mensaje
// pensado para el vecino (lo escribe el trigger) y se pasan tal cual; el
// resto se reemplaza por uno propio, para no mostrar detalles internos.
const CONOCIDOS = {
  P0001: [429],                                           // tope de reportes por hora
  P0002: [409],                                           // ya hay uno en ese lugar
  P0003: [422],                                           // foto muy grande o ilegible
  SIN_CONFIG: [503],                                      // falta DATABASE_URL en Vercel
  23505: [409, 'Ese reporte ya estaba cargado.'],
  23514: [422, 'Algún dato no es válido.'],               // reglas de la tabla
  23502: [422, 'Falta un dato obligatorio.'],
  '22P02': [400, 'Algún dato no tiene el formato esperado.'],
  22003: [400, 'Algún número está fuera de rango.'],
  42501: [403, 'Operación no permitida.'],
};

export function errorDeBase(err) {
  const conocido = CONOCIDOS[err?.code];
  if (conocido) {
    const [estado, mensaje] = conocido;
    return json({ code: err.code, message: mensaje || err.message }, estado);
  }
  // Inesperado: queda en los registros de Vercel, el vecino ve algo genérico.
  // El cliente guarda el reporte y lo reintenta solo ante errores 5xx.
  console.error(err);
  return json({ code: 'ERROR_SERVIDOR', message: 'Error del servidor.' }, 500);
}
