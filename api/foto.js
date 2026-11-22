// GET /api/foto?id=...  → foto aprobada de un basural, en base64 (o null)
import { comoPublico } from './_db.js';
import { json, malPedido, errorDeBase, UUID } from './_http.js';

export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!UUID.test(id)) return malPedido('Identificador inválido.');
  try {
    const [[fila]] = await comoPublico([['select public.foto_basural($1) as foto', [id]]]);
    // 10 minutos en la CDN: si se despublica una foto, tarda eso en desaparecer
    return json(fila?.foto ?? null, 200, { 'Cache-Control': 'public, s-maxage=600' });
  } catch (err) {
    return errorDeBase(err);
  }
}
