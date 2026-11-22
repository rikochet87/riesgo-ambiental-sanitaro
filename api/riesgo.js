// GET /api/riesgo?id=...  → índice de riesgo de un basural (o null)
import { comoPublico } from './_db.js';
import { json, malPedido, errorDeBase, UUID } from './_http.js';

export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!UUID.test(id)) return malPedido('Identificador inválido.');
  try {
    const [[fila]] = await comoPublico([['select public.riesgo_basural($1) as riesgo', [id]]]);
    // 5 minutos en la CDN: el índice cambia cuando cambian las capas o los reportes
    return json(fila?.riesgo ?? null, 200, { 'Cache-Control': 'public, s-maxage=300' });
  } catch (err) {
    return errorDeBase(err);
  }
}
