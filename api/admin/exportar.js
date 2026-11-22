// Copia de seguridad (solo con la sesión del moderador).
//
// GET  /api/admin/exportar?pagina=0  → todos los reportes con todos sus datos,
//                                      de a 1000 (las fotos se piden aparte,
//                                      una por una, a /api/admin/foto)
// POST /api/admin/exportar {reportes, fotos} → anota que se bajó una copia
//
// El ZIP lo arma el navegador: Vercel no deja que una función devuelva más
// de 4,5 MB, y con unas pocas fotos ya se pasaría.
import { comoModerador } from '../_db.js';
import { json, malPedido, errorDeBase } from '../_http.js';
import { controlar, leerJSON } from '../_admin.js';

export const POR_PAGINA = 1000;

export async function GET(request) {
  const corte = controlar(request);
  if (corte) return corte;

  const pagina = Number(new URL(request.url).searchParams.get('pagina') || 0);
  if (!Number.isInteger(pagina) || pagina < 0) return malPedido('Página inválida.');

  try {
    const [filas] = await comoModerador([[
      // Coordenadas completas (el mapa público las redondea; la copia no)
      `select id, creado_en, lat, lon, estado, tipo, tamano, quema, cerca_agua, cerca_escuela,
              antiguedad, descripcion, (foto is not null) as tiene_foto, foto_aprobada,
              octet_length(foto) as foto_bytes, revisado_en, nota_admin
       from public.reportes
       order by creado_en, id
       limit $1 offset $2`,
      [POR_PAGINA + 1, pagina * POR_PAGINA],
    ]]);
    const hayMas = filas.length > POR_PAGINA;
    return json({ reportes: filas.slice(0, POR_PAGINA), pagina, hay_mas: hayMas });
  } catch (err) {
    return errorDeBase(err);
  }
}

export async function POST(request) {
  const corte = controlar(request, { cambia: true });
  if (corte) return corte;

  const datos = await leerJSON(request, 200);
  const entero = (v) => Number.isInteger(v) && v >= 0;
  if (!datos || !entero(datos.reportes) || !entero(datos.fotos)) return malPedido('Datos de la copia inválidos.');

  try {
    const [[fila]] = await comoModerador([[
      'insert into public.admin_copias (reportes, fotos) values ($1, $2) returning hecha_en',
      [datos.reportes, datos.fotos],
    ]]);
    return json({ hecha_en: fila.hecha_en }, 201);
  } catch (err) {
    return errorDeBase(err);
  }
}
