// GET  /api/reportes  → basurales ya revisados, para el mapa público
// POST /api/reportes  → alta de un reporte vecinal
import { comoPublico } from './_db.js';
import { json, malPedido, errorDeBase, UUID } from './_http.js';

// Lo único que un vecino puede mandar. Coincide con el GRANT de la base;
// cualquier otra clave del JSON (estado, foto_aprobada...) se descarta.
const COLUMNAS = ['id', 'lat', 'lon', 'tipo', 'tamano', 'quema', 'cerca_agua',
                  'cerca_escuela', 'antiguedad', 'descripcion', 'foto_entrada'];

// Foto en base64 (la base acepta hasta 600.000 caracteres) más el resto
const PESO_MAX = 700_000;

export async function GET() {
  try {
    const [, filas] = await comoPublico([
      // Refresca hasta 20 índices guardados de más de un día (la persistencia avanza)
      ['select public.riesgo_refrescar(20)', []],
      // fecha como texto (AAAA-MM-DD): el driver la convertiría a Date
      [`select id, lat, lon, estado, tipo, tamano, quema, fecha::text as fecha, tiene_foto,
               riesgo_clase, riesgo_total
        from public.reportes_publicos
        order by fecha desc
        limit 3000`, []],
    ]);
    // Un minuto en la CDN de Vercel: el mapa no despierta la base en cada visita
    return json(filas, 200, { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' });
  } catch (err) {
    return errorDeBase(err);
  }
}

export async function POST(request) {
  // Exigir JSON obliga a cualquier otro sitio a pasar por CORS, que no autorizamos
  const tipo = (request.headers.get('content-type') || '').toLowerCase();
  if (!tipo.startsWith('application/json')) {
    return json({ code: 'FORMATO', message: 'Se esperaba un reporte en JSON.' }, 415);
  }
  if (Number(request.headers.get('content-length') || 0) > PESO_MAX) {
    return json({ code: 'P0003', message: 'La foto es demasiado grande.' }, 413);
  }

  let datos;
  try {
    const texto = await request.text();
    if (texto.length > PESO_MAX) {
      return json({ code: 'P0003', message: 'La foto es demasiado grande.' }, 413);
    }
    datos = JSON.parse(texto);
  } catch {
    return malPedido('El reporte no se pudo leer.');
  }
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    return malPedido('El reporte no se pudo leer.');
  }
  if (!UUID.test(String(datos.id ?? ''))) {
    return malPedido('Identificador de reporte inválido.');
  }

  // Nombres de columna de la lista fija; los valores siempre como parámetros
  const columnas = COLUMNAS.filter((c) => datos[c] !== undefined && datos[c] !== null);
  const marcas = columnas.map((_, i) => `$${i + 1}`);
  try {
    await comoPublico([[
      `insert into public.reportes (${columnas.join(', ')}) values (${marcas.join(', ')})`,
      columnas.map((c) => datos[c]),
    ]]);
    return json({ ok: true, id: datos.id }, 201);
  } catch (err) {
    return errorDeBase(err);
  }
}
