// GET   /api/admin/reportes?estado=pendiente  → reportes de ese estado (o "todos")
// PATCH /api/admin/reportes {id, estado?, foto_aprobada?, quitar_foto?, nota_admin?}
// Todo con el rol moderador, y solo con la sesión abierta.
import { comoModerador } from '../_db.js';
import { json, malPedido, errorDeBase, UUID } from '../_http.js';
import { controlar, leerJSON } from '../_admin.js';

const ESTADOS = ['pendiente', 'verificado', 'en_gestion', 'resuelto', 'descartado'];

export async function GET(request) {
  const corte = controlar(request);
  if (corte) return corte;

  const estado = new URL(request.url).searchParams.get('estado') || 'pendiente';
  if (estado !== 'todos' && !ESTADOS.includes(estado)) return malPedido('Estado desconocido.');

  try {
    const [filas, conteo] = await comoModerador([
      [`select id, creado_en, lat, lon, tipo, tamano, quema, cerca_agua, cerca_escuela, antiguedad,
               descripcion, estado, foto_aprobada, (foto is not null) as tiene_foto,
               revisado_en, nota_admin
        from public.reportes
        where $1 = 'todos' or estado = $1
        order by creado_en desc
        limit 300`, [estado]],
      ['select estado, count(*)::int as n from public.reportes group by estado', []],
    ]);
    const cantidades = Object.fromEntries(ESTADOS.map((e) => [e, 0]));
    for (const { estado: e, n } of conteo) cantidades[e] = n;
    return json({ reportes: filas, cantidades });
  } catch (err) {
    return errorDeBase(err);
  }
}

export async function PATCH(request) {
  const corte = controlar(request, { cambia: true });
  if (corte) return corte;

  const datos = await leerJSON(request);
  if (!datos) return malPedido('El pedido no se pudo leer.');
  if (!UUID.test(String(datos.id ?? ''))) return malPedido('Identificador inválido.');

  // Solo estos cambios; el resto del JSON se ignora
  const cambios = [];
  const valores = [datos.id];
  const agregar = (columna, valor) => { valores.push(valor); cambios.push(`${columna} = $${valores.length}`); };

  if (datos.estado !== undefined) {
    if (!ESTADOS.includes(datos.estado)) return malPedido('Estado desconocido.');
    agregar('estado', datos.estado);
  }
  if (datos.quitar_foto === true) {
    cambios.push('foto = null', 'foto_aprobada = false');
  } else if (datos.foto_aprobada !== undefined) {
    if (typeof datos.foto_aprobada !== 'boolean') return malPedido('foto_aprobada tiene que ser sí o no.');
    agregar('foto_aprobada', datos.foto_aprobada);
  }
  if (datos.nota_admin !== undefined) {
    if (datos.nota_admin !== null && typeof datos.nota_admin !== 'string') return malPedido('Nota inválida.');
    const nota = datos.nota_admin?.trim() || null;
    if (nota && nota.length > 500) return malPedido('La nota puede tener hasta 500 caracteres.');
    agregar('nota_admin', nota);
  }
  if (!cambios.length) return malPedido('No hay nada para cambiar.');
  cambios.push('revisado_en = now()');

  try {
    const [filas] = await comoModerador([[
      `update public.reportes set ${cambios.join(', ')}
       where id = $1
       returning id, estado, foto_aprobada, (foto is not null) as tiene_foto, revisado_en, nota_admin`,
      valores,
    ]]);
    if (!filas.length) return json({ code: 'NO_EXISTE', message: 'Ese reporte no existe.' }, 404);
    return json(filas[0]);
  } catch (err) {
    return errorDeBase(err);
  }
}
