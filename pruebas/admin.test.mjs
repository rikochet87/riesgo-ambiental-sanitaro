// Pruebas del panel de moderación (/api/admin) contra el Postgres local.
// Requiere además neon/moderacion.sql cargado en la base de prueba.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ejecutorLocal, admin } from './_postgres_local.mjs';
import { usarEjecutorDePrueba } from '../api/_db.js';
import { cookieDeSesion } from '../api/_admin.js';
import * as reportesPublicos from '../api/reportes.js';
import * as fotoPublica from '../api/foto.js';
import * as entrar from '../api/admin/entrar.js';
import * as moderar from '../api/admin/reportes.js';
import * as fotoAdmin from '../api/admin/foto.js';
import * as exportar from '../api/admin/exportar.js';
import * as riesgoAdmin from '../api/admin/riesgo.js';
import * as riesgoPublico from '../api/riesgo.js';

const SITIO = 'https://riesgo-ambiental-sanitaro.vercel.app';
const CLAVE = 'una-clave-de-prueba-larga';
const ID_FOTO = '44444444-4444-4444-8444-444444444444';
const ID_SIN_FOTO = '55555555-5555-4555-8555-555555555555';
const FOTO = Buffer.from('foto pendiente').toString('base64');

const pedir = (ruta, { metodo = 'GET', cuerpo, cookie, origen, tipo = 'application/json' } = {}) =>
  new Request(SITIO + ruta, {
    method: metodo,
    headers: { ...(cuerpo !== undefined && { 'Content-Type': tipo }),
               ...(cookie && { Cookie: cookie }), ...(origen && { Origin: origen }) },
    body: cuerpo === undefined ? undefined : (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)),
  });
const leer = async (res) => ({ estado: res.status, cuerpo: await res.json(),
                               cookie: res.headers.get('set-cookie'), cache: res.headers.get('cache-control') });
const valorCookie = (setCookie) => setCookie.split(';')[0];

async function entrarCon(clave) {
  return leer(await entrar.POST(pedir('/api/admin/entrar', { metodo: 'POST', cuerpo: { clave }, origen: SITIO })));
}
async function sesion() {
  const r = await entrarCon(CLAVE);
  assert.equal(r.estado, 200);
  return valorCookie(r.cookie);
}

before(async () => {
  usarEjecutorDePrueba(ejecutorLocal);
  await admin('truncate public.reportes cascade');
  for (const [id, extra] of [[ID_FOTO, { foto_entrada: FOTO, descripcion: '<img src=x onerror=alert(1)> junto al canal' }],
                             [ID_SIN_FOTO, { lat: -27.48 }]]) {
    const r = await reportesPublicos.POST(new Request(SITIO + '/api/reportes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, lat: -27.46, lon: -58.98, tipo: 'mixto', ...extra }),
    }));
    assert.equal(r.status, 201);
  }
});
beforeEach(async () => {
  process.env.ADMIN_CLAVE = CLAVE;
  await admin('truncate public.admin_intentos');
});
after(async () => {
  await admin('truncate public.reportes cascade');
  await admin('truncate public.admin_intentos');
  await admin('truncate public.admin_copias');
});

test('sin ADMIN_CLAVE, o con una de menos de 12 caracteres, el panel no abre', async () => {
  for (const valor of [undefined, 'corta']) {
    if (valor === undefined) delete process.env.ADMIN_CLAVE; else process.env.ADMIN_CLAVE = valor;
    assert.equal((await entrarCon('corta')).estado, 503);
    assert.equal((await leer(await moderar.GET(pedir('/api/admin/reportes')))).cuerpo.code, 'ADMIN_SIN_CONFIG');
  }
});

test('clave incorrecta: 401 y sin cookie', async () => {
  const r = await entrarCon('no-es-la-clave-correcta');
  assert.equal(r.estado, 401);
  assert.equal(r.cuerpo.code, 'CLAVE');
  assert.equal(r.cookie, null);
});

test('clave correcta: cookie HttpOnly, Secure, SameSite=Strict, solo para /api/admin', async () => {
  const r = await entrarCon(CLAVE);
  assert.equal(r.estado, 200);
  for (const atributo of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/admin', 'Max-Age=28800']) {
    assert.ok(r.cookie.includes(atributo), `falta ${atributo}`);
  }
});

test('sin sesión no se ve nada; con sesión, la lista trae pendientes, descripción y cantidades', async () => {
  const sin = await leer(await moderar.GET(pedir('/api/admin/reportes')));
  assert.equal(sin.estado, 401);
  assert.equal((await leer(await fotoAdmin.GET(pedir(`/api/admin/foto?id=${ID_FOTO}`)))).estado, 401);

  const con = await leer(await moderar.GET(pedir('/api/admin/reportes?estado=pendiente', { cookie: await sesion() })));
  assert.equal(con.estado, 200);
  assert.match(con.cache, /no-store/, 'la lista del moderador nunca va a la CDN');
  assert.equal(con.cuerpo.reportes.length, 2);
  assert.equal(con.cuerpo.cantidades.pendiente, 2);
  const conFoto = con.cuerpo.reportes.find((r) => r.id === ID_FOTO);
  assert.equal(conFoto.tiene_foto, true);
  assert.match(conFoto.descripcion, /junto al canal/);
});

test('el moderador ve la foto aunque no esté aprobada; el público no', async () => {
  const cookie = await sesion();
  const r = await leer(await fotoAdmin.GET(pedir(`/api/admin/foto?id=${ID_FOTO}`, { cookie })));
  assert.equal(r.cuerpo, FOTO);
  assert.match(r.cache, /private/);
  assert.equal(await (await fotoPublica.GET(pedir(`/api/foto?id=${ID_FOTO}`))).json(), null);
});

test('cookie manipulada, vencida o de una clave anterior: 401', async () => {
  const buena = await sesion();
  const [nombre, valor] = buena.split('=');
  const [vence, firma] = valor.split('.');
  const casos = {
    manipulada: `${nombre}=${Number(vence) + 86400}.${firma}`,
    inventada: `${nombre}=9999999999.AAAA`,
  };
  const real = Date.now;
  Date.now = () => real() - 9 * 3600 * 1000;
  casos.vencida = valorCookie(cookieDeSesion());
  Date.now = real;
  for (const [caso, cookie] of Object.entries(casos)) {
    assert.equal((await moderar.GET(pedir('/api/admin/reportes', { cookie }))).status, 401, caso);
  }
  process.env.ADMIN_CLAVE = 'otra-clave-distinta-larga';
  assert.equal((await moderar.GET(pedir('/api/admin/reportes', { cookie: buena }))).status, 401,
               'cambiar la clave cierra las sesiones abiertas');
});

test('cambios desde otro sitio o sin JSON: rechazados', async () => {
  const cookie = await sesion();
  const otro = await leer(await moderar.PATCH(pedir('/api/admin/reportes',
    { metodo: 'PATCH', cuerpo: { id: ID_FOTO, estado: 'verificado' }, cookie, origen: 'https://otro-sitio.com' })));
  assert.equal(otro.estado, 403);
  const texto = await moderar.PATCH(pedir('/api/admin/reportes',
    { metodo: 'PATCH', cuerpo: { id: ID_FOTO, estado: 'verificado' }, cookie, origen: SITIO, tipo: 'text/plain' }));
  assert.equal(texto.status, 415);
  const [{ estado }] = await admin('select estado from public.reportes where id = $1', [ID_FOTO]);
  assert.equal(estado, 'pendiente');
});

test('publicar con foto: aparece en el mapa público con su foto', async () => {
  const cookie = await sesion();
  const r = await leer(await moderar.PATCH(pedir('/api/admin/reportes',
    { metodo: 'PATCH', cuerpo: { id: ID_FOTO, estado: 'verificado', foto_aprobada: true }, cookie, origen: SITIO })));
  assert.equal(r.estado, 200);
  assert.equal(r.cuerpo.estado, 'verificado');
  assert.equal(r.cuerpo.foto_aprobada, true);
  assert.ok(r.cuerpo.revisado_en);

  const mapa = await (await reportesPublicos.GET(pedir('/api/reportes'))).json();
  assert.deepEqual(mapa.map((x) => x.id), [ID_FOTO]);
  assert.equal(await (await fotoPublica.GET(pedir(`/api/foto?id=${ID_FOTO}`))).json(), FOTO);
});

test('quitar la foto la borra de la base y del mapa; la nota queda guardada', async () => {
  const cookie = await sesion();
  const r = await leer(await moderar.PATCH(pedir('/api/admin/reportes',
    { metodo: 'PATCH', cuerpo: { id: ID_FOTO, quitar_foto: true, nota_admin: '  Se ve una patente  ' }, cookie, origen: SITIO })));
  assert.equal(r.estado, 200);
  assert.equal(r.cuerpo.tiene_foto, false);
  assert.equal(r.cuerpo.nota_admin, 'Se ve una patente');
  const [{ bytes }] = await admin('select octet_length(foto) as bytes from public.reportes where id = $1', [ID_FOTO]);
  assert.equal(bytes, null);
  const [enMapa] = await (await reportesPublicos.GET(pedir('/api/reportes'))).json();
  assert.equal(enMapa.tiene_foto, false);
});

test('tamaño según la foto: corrige el índice y el mapa sin tocar lo que dijo el vecino', async () => {
  const cookie = await sesion();
  const patch = async (cuerpo) => leer(await moderar.PATCH(pedir('/api/admin/reportes',
    { metodo: 'PATCH', cuerpo: { id: ID_FOTO, ...cuerpo }, cookie, origen: SITIO })));
  const enMapa = async () => (await (await reportesPublicos.GET(pedir('/api/reportes'))).json())
    .find((x) => x.id === ID_FOTO);
  const amenaza = async () => (await (await riesgoAdmin.GET(pedir(`/api/admin/riesgo?id=${ID_FOTO}`, { cookie }))).json()).amenaza;

  await admin(`update public.reportes set tamano = 'carretilla', tamano_moderado = null where id = $1`, [ID_FOTO]);
  assert.equal((await enMapa()).tamano, 'carretilla');
  assert.equal((await amenaza()).tamano, 0.3);

  const r = await patch({ tamano_moderado: 'camion_o_mas' });
  assert.equal(r.estado, 200);
  assert.equal(r.cuerpo.tamano_moderado, 'camion_o_mas');
  const [fila] = await admin('select tamano, tamano_moderado from public.reportes where id = $1', [ID_FOTO]);
  assert.deepEqual(fila, { tamano: 'carretilla', tamano_moderado: 'camion_o_mas' }, 'lo del vecino queda guardado');
  assert.equal((await enMapa()).tamano, 'camion_o_mas', 'el mapa muestra la corrección');
  const a = await amenaza();
  assert.equal(a.tamano, 1);
  assert.equal(a.tamano_corregido, true);

  const lista = await leer(await moderar.GET(pedir('/api/admin/reportes?estado=todos', { cookie })));
  assert.equal(lista.cuerpo.reportes.find((x) => x.id === ID_FOTO).tamano_moderado, 'camion_o_mas');

  assert.equal((await patch({ tamano_moderado: 'enorme' })).estado, 400);
  assert.equal((await patch({ tamano: 'bolsas' })).estado, 400, 'el tamaño del vecino no se edita desde el panel');

  assert.equal((await patch({ tamano_moderado: null })).cuerpo.tamano_moderado, null);
  assert.equal((await enMapa()).tamano, 'carretilla', 'sin corrección vuelve lo del vecino');
  const b = await amenaza();
  assert.equal(b.tamano, 0.3);
  assert.equal(b.tamano_corregido, false);
});

test('el público no puede mandar un tamaño corregido', async () => {
  const id = '66666666-6666-4666-8666-666666666666';
  const r = await reportesPublicos.POST(new Request(SITIO + '/api/reportes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, lat: -27.45, lon: -58.97, tamano: 'bolsas', tamano_moderado: 'camion_o_mas' }),
  }));
  assert.equal(r.status, 201);
  const [fila] = await admin('select tamano, tamano_moderado from public.reportes where id = $1', [id]);
  assert.deepEqual(fila, { tamano: 'bolsas', tamano_moderado: null });
  await assert.rejects(ejecutorLocal('anonymous', [[`update public.reportes set tamano_moderado = 'bolsas'`, []]]),
                       (e) => e.code === '42501');
  await admin('delete from public.reportes where id = $1', [id]);
});

test('mapa por riesgo: moderar recalcula el reporte y sus vecinos; "ya no está" sale del mapa', async () => {
  const cookie = await sesion();
  const VECINO = '77777777-7777-4777-8777-777777777777';
  const patch = async (id, cuerpo) => leer(await moderar.PATCH(pedir('/api/admin/reportes',
    { metodo: 'PATCH', cuerpo: { id, ...cuerpo }, cookie, origen: SITIO })));
  const guardado = async (id) => (await admin('select total, clase from public.riesgo_cache where reporte_id = $1', [id]))[0];
  const enMapa = async () => (await (await reportesPublicos.GET(pedir('/api/reportes'))).json()).map((x) => x.id);

  await admin(`update public.reportes set estado = 'verificado' where id = $1`, [ID_FOTO]);
  const r0 = await patch(ID_FOTO, { nota_admin: 'recalcular' });
  assert.equal(r0.estado, 200);
  assert.ok(r0.cuerpo.riesgos.some((x) => x.id === ID_FOTO && x.clase), 'la respuesta trae las clases para repintar');
  const solo = await guardado(ID_FOTO);

  // Un vecino a ~60 m: al publicarlo, el índice del primero sube (un activo más cerca)
  const alta = await reportesPublicos.POST(new Request(SITIO + '/api/reportes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: VECINO, lat: -27.4605, lon: -58.9805 }),
  }));
  assert.equal(alta.status, 201);
  assert.equal(await guardado(VECINO), undefined, 'un pendiente no tiene índice guardado');
  await patch(VECINO, { estado: 'verificado' });
  assert.ok((await guardado(VECINO)).clase);
  assert.ok((await guardado(ID_FOTO)).total > solo.total, 'el vecino publicado cuenta en el índice del primero');

  // "Ya no está" (resuelto): sale del mapa, de la foto y del índice público, y el primero vuelve a bajar
  await patch(VECINO, { estado: 'resuelto' });
  assert.equal(await guardado(VECINO), undefined);
  assert.deepEqual(await guardado(ID_FOTO), solo);
  assert.ok(!(await enMapa()).includes(VECINO));
  assert.equal(await (await riesgoPublico.GET(pedir(`/api/riesgo?id=${VECINO}`))).json(), null);

  // Eliminar también recalcula a los vecinos
  await patch(VECINO, { estado: 'verificado' });
  assert.ok((await guardado(ID_FOTO)).total > solo.total);
  const borrado = await leer(await moderar.DELETE(pedir('/api/admin/reportes',
    { metodo: 'DELETE', cuerpo: { id: VECINO }, cookie, origen: SITIO })));
  assert.equal(borrado.estado, 200);
  assert.deepEqual(await guardado(ID_FOTO), solo);
  assert.ok(!borrado.cuerpo.riesgos.some((x) => x.id === VECINO));
});

test('una foto aprobada de un basural que "ya no está" no se sirve al público', async () => {
  await admin(`update public.reportes set estado = 'resuelto', foto_aprobada = true where id = $1`, [ID_FOTO]);
  try {
    assert.equal(await (await fotoPublica.GET(pedir(`/api/foto?id=${ID_FOTO}`))).json(), null);
  } finally {
    await admin(`update public.reportes set estado = 'verificado' where id = $1`, [ID_FOTO]);
  }
});

test('pedidos inválidos: estado inventado, id inexistente, solo campos no permitidos, nota larga', async () => {
  const cookie = await sesion();
  const casos = [
    [{ id: ID_SIN_FOTO, estado: 'aprobadisimo' }, 400],
    [{ id: '99999999-9999-4999-8999-999999999999', estado: 'resuelto' }, 404],
    [{ id: ID_SIN_FOTO, lat: -27.0, lon: -58.0, descripcion: 'cambiada', creado_en: '2020-01-01' }, 400],
    [{ id: ID_SIN_FOTO, nota_admin: 'x'.repeat(501) }, 400],
    [{ id: ID_SIN_FOTO, foto_aprobada: 'si' }, 400],
  ];
  for (const [cuerpo, estado] of casos) {
    const r = await moderar.PATCH(pedir('/api/admin/reportes', { metodo: 'PATCH', cuerpo, cookie, origen: SITIO }));
    assert.equal(r.status, estado, JSON.stringify(cuerpo));
  }
  const [fila] = await admin('select lat, descripcion, estado from public.reportes where id = $1', [ID_SIN_FOTO]);
  assert.deepEqual(fila, { lat: -27.48, descripcion: null, estado: 'pendiente' });
  assert.equal((await moderar.GET(pedir('/api/admin/reportes?estado=cualquiera', { cookie }))).status, 400);
});

test('el rol moderador, aunque el código fallara, no puede mover un reporte ni editar lo del vecino', async () => {
  for (const sql of ['update public.reportes set lat = -27.0',
                     'update public.reportes set descripcion = $$x$$', 'update public.reportes set tamano = $$bolsas$$',
                     'select * from public.admin_intentos']) {
    await assert.rejects(ejecutorLocal('moderador', [[sql, []]]), (e) => e.code === '42501', sql);
  }
});

test('10 claves incorrectas bloquean la entrada 15 minutos, aunque después venga la correcta', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await entrarCon(`intento-incorrecto-${i}`)).estado, 401);
  const r = await entrarCon(CLAVE);
  assert.equal(r.estado, 429);
  assert.equal(r.cuerpo.code, 'BLOQUEADO');
  assert.equal(r.cookie, null);
});

test('copia de seguridad: sin sesión no hay nada; con sesión, todos los datos y coordenadas completas', async () => {
  await admin('truncate public.admin_copias');
  assert.equal((await exportar.GET(pedir('/api/admin/exportar'))).status, 401);

  const cookie = await sesion();
  const r = await leer(await exportar.GET(pedir('/api/admin/exportar?pagina=0', { cookie })));
  assert.equal(r.estado, 200);
  assert.match(r.cache, /no-store/);
  assert.equal(r.cuerpo.hay_mas, false);
  assert.equal(r.cuerpo.reportes.length, 2);
  const conFoto = r.cuerpo.reportes.find((x) => x.id === ID_FOTO);
  assert.equal(conFoto.lat, -27.46, 'la copia no redondea');
  assert.match(conFoto.descripcion, /junto al canal/);
  for (const campo of ['creado_en', 'estado', 'tipo', 'tamano', 'quema', 'cerca_agua', 'cerca_escuela', 'antiguedad',
                       'tiene_foto', 'foto_aprobada', 'foto_bytes', 'revisado_en', 'nota_admin']) {
    assert.ok(campo in conFoto, `falta ${campo}`);
  }
  assert.equal(r.cuerpo.reportes.find((x) => x.id === ID_SIN_FOTO).foto_bytes, null);
  assert.equal((await exportar.GET(pedir('/api/admin/exportar?pagina=-1', { cookie }))).status, 400);
});

test('copia de seguridad: pagina de a 1000 sin perder ni repetir reportes', async () => {
  // 1001 reportes extra, salteando el trigger (su tope por hora es justamente para esto)
  await admin(`set session_replication_role = replica;
    insert into public.reportes (id, lat, lon, creado_en)
    select gen_random_uuid(), -27.4, -58.9, now() - (n || ' seconds')::interval from generate_series(1, 1001) n;
    set session_replication_role = origin;`);
  try {
    const cookie = await sesion();
    const p0 = await leer(await exportar.GET(pedir('/api/admin/exportar?pagina=0', { cookie })));
    const p1 = await leer(await exportar.GET(pedir('/api/admin/exportar?pagina=1', { cookie })));
    assert.equal(p0.cuerpo.reportes.length, 1000);
    assert.equal(p0.cuerpo.hay_mas, true);
    assert.equal(p1.cuerpo.reportes.length, 3);
    assert.equal(p1.cuerpo.hay_mas, false);
    const ids = new Set([...p0.cuerpo.reportes, ...p1.cuerpo.reportes].map((x) => x.id));
    assert.equal(ids.size, 1003);
  } finally {
    await admin(`delete from public.reportes where id not in ($1, $2)`, [ID_FOTO, ID_SIN_FOTO]);
  }
});

test('copia de seguridad: se anota y la lista del panel muestra la última', async () => {
  await admin('truncate public.admin_copias');
  const cookie = await sesion();
  const antes = await leer(await moderar.GET(pedir('/api/admin/reportes', { cookie })));
  assert.equal(antes.cuerpo.ultima_copia, null);

  const otro = await exportar.POST(pedir('/api/admin/exportar',
    { metodo: 'POST', cuerpo: { reportes: 2, fotos: 1 }, cookie, origen: 'https://otro-sitio.com' }));
  assert.equal(otro.status, 403);
  assert.equal((await exportar.POST(pedir('/api/admin/exportar',
    { metodo: 'POST', cuerpo: { reportes: -1, fotos: 0 }, cookie, origen: SITIO }))).status, 400);

  const r = await leer(await exportar.POST(pedir('/api/admin/exportar',
    { metodo: 'POST', cuerpo: { reportes: 2, fotos: 1 }, cookie, origen: SITIO })));
  assert.equal(r.estado, 201);
  const despues = await leer(await moderar.GET(pedir('/api/admin/reportes', { cookie })));
  assert.ok(despues.cuerpo.ultima_copia);

  await assert.rejects(ejecutorLocal('anonymous', [['select * from public.admin_copias', []]]),
                       (e) => e.code === '42501', 'el público no ve las copias');
  await assert.rejects(ejecutorLocal('moderador', [['delete from public.admin_copias', []]]),
                       (e) => e.code === '42501', 'el moderador no borra el registro');
});

test('índice de riesgo: el moderador lo ve también en pendientes; el público, solo en publicados', async () => {
  await admin(`update public.reportes set estado = 'pendiente' where id = $1`, [ID_SIN_FOTO]);
  assert.equal((await riesgoAdmin.GET(pedir(`/api/admin/riesgo?id=${ID_SIN_FOTO}`))).status, 401, 'sin sesión no');

  const cookie = await sesion();
  const r = await leer(await riesgoAdmin.GET(pedir(`/api/admin/riesgo?id=${ID_SIN_FOTO}`, { cookie })));
  assert.equal(r.estado, 200);
  assert.equal(typeof r.cuerpo.total, 'number', 'un pendiente tiene índice para el moderador');
  assert.match(r.cache, /private/);
  assert.equal(await (await riesgoPublico.GET(pedir(`/api/riesgo?id=${ID_SIN_FOTO}`))).json(), null,
               'el público sigue sin ver el índice de un pendiente');
  assert.equal((await riesgoAdmin.GET(pedir('/api/admin/riesgo?id=nada', { cookie }))).status, 400);

  // Mismo número por las dos puertas cuando el reporte está publicado
  const [{ estado }] = await admin('select estado from public.reportes where id = $1', [ID_FOTO]);
  assert.equal(estado, 'verificado');
  const porAdmin = await (await riesgoAdmin.GET(pedir(`/api/admin/riesgo?id=${ID_FOTO}`, { cookie }))).json();
  const porPublico = await (await riesgoPublico.GET(pedir(`/api/riesgo?id=${ID_FOTO}`))).json();
  assert.deepEqual(porAdmin, porPublico);
});

test('las funciones del índice: cada rol solo llega a su puerta', async () => {
  const casos = [
    ['anonymous', `select public.riesgo_basural_moderacion('${ID_SIN_FOTO}')`],
    ['anonymous', `select public.riesgo_calculo('${ID_SIN_FOTO}', false)`],
    ['moderador', `select public.riesgo_calculo('${ID_SIN_FOTO}', false)`],
  ];
  for (const [rol, sql] of casos) {
    await assert.rejects(ejecutorLocal(rol, [[sql, []]]), (e) => e.code === '42501', `${rol}: ${sql}`);
  }
});

test('eliminar: exige sesión, mismo sitio y JSON; borra el reporte entero y su análisis satelital', async () => {
  const ID_BORRAR = '66666666-6666-4666-8666-666666666666';
  await admin(`insert into public.reportes (id, lat, lon, estado, foto) values ($1, -27.45, -58.97, 'verificado', '\\x01'::bytea)`, [ID_BORRAR]);
  await admin('insert into public.amenaza_satelital (reporte_id, area_m2) values ($1, 900)', [ID_BORRAR]);
  const cuerpo = { id: ID_BORRAR };

  assert.equal((await moderar.DELETE(pedir('/api/admin/reportes', { metodo: 'DELETE', cuerpo, origen: SITIO }))).status, 401);
  const cookie = await sesion();
  assert.equal((await moderar.DELETE(pedir('/api/admin/reportes',
    { metodo: 'DELETE', cuerpo, cookie, origen: 'https://otro-sitio.com' }))).status, 403);
  assert.equal((await moderar.DELETE(pedir('/api/admin/reportes',
    { metodo: 'DELETE', cuerpo, cookie, origen: SITIO, tipo: 'text/plain' }))).status, 415);
  assert.equal((await moderar.DELETE(pedir('/api/admin/reportes',
    { metodo: 'DELETE', cuerpo: { id: 'nada' }, cookie, origen: SITIO }))).status, 400);
  const [{ n: sigue }] = await admin('select count(*)::int as n from public.reportes where id = $1', [ID_BORRAR]);
  assert.equal(sigue, 1, 'ninguno de esos pedidos tiene que haber borrado nada');

  const r = await leer(await moderar.DELETE(pedir('/api/admin/reportes', { metodo: 'DELETE', cuerpo, cookie, origen: SITIO })));
  assert.equal(r.estado, 200);
  assert.equal(r.cuerpo.eliminado, ID_BORRAR);
  const [quedan] = await admin(`select (select count(*)::int from public.reportes where id = $1) as reporte,
                                       (select count(*)::int from public.amenaza_satelital where reporte_id = $1) as satelite`, [ID_BORRAR]);
  assert.deepEqual(quedan, { reporte: 0, satelite: 0 });
  const mapa = await (await reportesPublicos.GET(pedir('/api/reportes'))).json();
  assert.ok(!mapa.some((x) => x.id === ID_BORRAR), 'ya no está en el mapa público');

  const otraVez = await leer(await moderar.DELETE(pedir('/api/admin/reportes', { metodo: 'DELETE', cuerpo, cookie, origen: SITIO })));
  assert.equal(otraVez.estado, 404);
});

test('el público sigue sin poder borrar nada', async () => {
  await assert.rejects(ejecutorLocal('anonymous', [['delete from public.reportes', []]]), (e) => e.code === '42501');
});

test('salir vence la cookie', async () => {
  const r = await leer(await entrar.DELETE(pedir('/api/admin/entrar', { metodo: 'DELETE' })));
  assert.match(r.cookie, /Max-Age=0/);
});
