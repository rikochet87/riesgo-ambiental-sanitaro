// GET /api/admin/riesgo?id=...  → índice de riesgo de cualquier reporte,
// también pendiente o descartado (la versión pública solo calcula publicados)
import { comoModerador } from '../_db.js';
import { json, malPedido, errorDeBase, UUID } from '../_http.js';
import { controlar } from '../_admin.js';

export async function GET(request) {
  const corte = controlar(request);
  if (corte) return corte;

  const id = new URL(request.url).searchParams.get('id') || '';
  if (!UUID.test(id)) return malPedido('Identificador inválido.');
  try {
    const [[fila]] = await comoModerador([['select public.riesgo_basural_moderacion($1) as riesgo', [id]]]);
    return json(fila?.riesgo ?? null, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return errorDeBase(err);
  }
}
