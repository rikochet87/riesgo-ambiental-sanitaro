// GET /api/admin/foto?id=...  → foto de cualquier reporte, aprobada o no (base64)
import { comoModerador } from '../_db.js';
import { json, malPedido, errorDeBase, UUID } from '../_http.js';
import { controlar } from '../_admin.js';

export async function GET(request) {
  const corte = controlar(request);
  if (corte) return corte;

  const id = new URL(request.url).searchParams.get('id') || '';
  if (!UUID.test(id)) return malPedido('Identificador inválido.');
  try {
    const [[fila]] = await comoModerador([[
      // encode() corta en líneas de 76 caracteres; el navegador las necesita fuera
      `select translate(encode(foto, 'base64'), E'\\n', '') as foto from public.reportes where id = $1`, [id],
    ]]);
    // Nunca en la CDN: la sesión es personal
    return json(fila?.foto ?? null, 200, { 'Cache-Control': 'private, no-store' });
  } catch (err) {
    return errorDeBase(err);
  }
}
