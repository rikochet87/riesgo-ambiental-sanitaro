// GET   /api/admin/reportes?estado=todos&pagina=0  → reportes de ese estado (o todos), de a 1000
// PATCH /api/admin/reportes {id, estado?, foto_aprobada?, quitar_foto?, nota_admin?}
// DELETE /api/admin/reportes {id}  → elimina el reporte entero (el panel pide confirmación)
// Todo con el rol moderador, y solo con la sesión abierta.
import { comoModerador } from '../_db.js';
import { json, malPedido, errorDeBase, UUID } from '../_http.js';
import { controlar, leerJSON } from '../_admin.js';

const ESTADOS = ['pendiente', 'verificado', 'en_gestion', 'resuelto', 'descartado'];
const TAMANOS = ['bolsas', 'carretilla', 'camioneta', 'camion_o_mas'];
const POR_PAGINA = 1000;

export async function GET(request) {
  const corte = controlar(request);
  if (corte) return corte;

  const parametros = new URL(request.url).searchParams;
  const estado = parametros.get('estado') || 'pendiente';
  if (estado !== 'todos' && !ESTADOS.includes(estado)) return malPedido('Estado desconocido.');
  const pagina = Number(parametros.get('pagina') || 0);
  if (!Number.isInteger(pagina) || pagina < 0) return malPedido('Página inválida.');

  try {
    const [filas, conteo, [copia]] = await comoModerador([
      [`select id, creado_en, lat, lon, tipo, tamano, tamano_moderado, quema, cerca_agua, cerca_escuela,
               antiguedad, descripcion, estado, foto_aprobada, (foto is not null) as tiene_foto,
               revisado_en, nota_admin
        from public.reportes
        where $1 = 'todos' or estado = $1
        order by creado_en desc, id
        limit $2 offset $3`, [estado, POR_PAGINA + 1, pagina * POR_PAGINA]],
      ['select estado, count(*)::int as n from public.reportes group by estado', []],
      ['select max(hecha_en) as ultima from public.admin_copias', []],
    ]);
    const cantidades = Object.fromEntries(ESTADOS.map((e) => [e, 0]));
    for (const { estado: e, n } of conteo) cantidades[e] = n;
    return json({ reportes: filas.slice(0, POR_PAGINA), hay_mas: filas.length > POR_PAGINA,
                  cantidades, ultima_copia: copia?.ultima ?? null });
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
  if (datos.tamano_moderado !== undefined) {
    // null = usar lo que dijo el vecino
    if (datos.tamano_moderado !== null && !TAMANOS.includes(datos.tamano_moderado)) return malPedido('Tamaño desconocido.');
    agregar('tamano_moderado', datos.tamano_moderado);
  }
  if (!cambios.length) return malPedido('No hay nada para cambiar.');
  cambios.push('revisado_en = now()');

  try {
    const [filas] = await comoModerador([[
      `update public.reportes set ${cambios.join(', ')}
       where id = $1
       returning id, estado, foto_aprobada, (foto is not null) as tiene_foto, revisado_en, nota_admin,
                 tamano_moderado`,
      valores,
    ]]);
    if (!filas.length) return json({ code: 'NO_EXISTE', message: 'Ese reporte no existe.' }, 404);
    return json(filas[0]);
  } catch (err) {
    return errorDeBase(err);
  }
}

export async function DELETE(request) {
  // Mismo control que cualquier cambio: sesión, mismo sitio y JSON
  const corte = controlar(request, { cambia: true });
  if (corte) return corte;

  const datos = await leerJSON(request, 200);
  if (!datos || !UUID.test(String(datos.id ?? ''))) return malPedido('Identificador inválido.');

  try {
    const [filas] = await comoModerador([[
      'delete from public.reportes where id = $1 returning id, estado', [datos.id],
    ]]);
    if (!filas.length) return json({ code: 'NO_EXISTE', message: 'Ese reporte ya no existe.' }, 404);
    return json({ eliminado: filas[0].id, estado: filas[0].estado });
  } catch (err) {
    return errorDeBase(err);
  }
}
