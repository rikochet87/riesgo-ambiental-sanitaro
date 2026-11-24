// Pruebas de las funciones de /api contra un Postgres local con el esquema real.
//
// Preparación (una vez):
//   createdb prueba_api
//   psql -d prueba_api -f neon/schema.sql -f neon/riesgo.sql
//   (los roles anonymous y authenticated tienen que existir)
// Correr:
//   npm test            (usa PGHOST / PGDATABASE si están definidas)
//
// Las funciones son las mismas que corren en Vercel; lo único que cambia es
// quién ejecuta las consultas: acá pg contra la base local, allá el driver
// de Neon. En los dos casos dentro de una transacción con el rol anonymous.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ejecutorLocal, admin } from './_postgres_local.mjs';
import { usarEjecutorDePrueba } from '../api/_db.js';
import * as reportes from '../api/reportes.js';
import * as foto from '../api/foto.js';
import * as riesgo from '../api/riesgo.js';
import { normalizarIP, origenDe } from '../api/_origen.js';
import { randomBytes } from 'node:crypto';

const URL_BASE = 'https://riesgo-ambiental-sanitaro.vercel.app';
const pedir = (ruta, opciones) => new Request(URL_BASE + ruta, opciones);
const postJSON = (cuerpo, cabeceras = {}) => pedir('/api/reportes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...cabeceras },
  body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
});
const leer = async (res) => ({ estado: res.status, cuerpo: await res.json(), cache: res.headers.get('cache-control') });

const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_3 = '33333333-3333-4333-8333-333333333333';
const FOTO = Buffer.from('foto de prueba').toString('base64');

before(async () => {
  usarEjecutorDePrueba(ejecutorLocal);
  await admin('truncate public.reportes cascade');
  await admin('truncate public.limite_origen');
});
after(async () => {
  await admin('truncate public.reportes cascade');
  await admin('truncate public.limite_origen');
});

test('el mapa público arranca vacío y se cachea un minuto en la CDN', async () => {
  const r = await leer(await reportes.GET(pedir('/api/reportes')));
  assert.equal(r.estado, 200);
  assert.deepEqual(r.cuerpo, []);
  assert.match(r.cache, /s-maxage=60/);
});

test('alta de un reporte con foto', async () => {
  const r = await leer(await reportes.POST(postJSON({
    id: ID_1, lat: -27.4606, lon: -58.9839, tipo: 'mixto', tamano: 'camioneta',
    quema: true, cerca_agua: false, cerca_escuela: true, antiguedad: 'meses',
    descripcion: '  al lado del canal  ', foto_entrada: FOTO,
  })));
  assert.equal(r.estado, 201);
  assert.equal(r.cuerpo.id, ID_1);

  const [fila] = await admin(
    `select estado, foto_aprobada, foto_entrada, octet_length(foto) as bytes, descripcion,
            gis.st_astext(geom) as punto
     from public.reportes where id = $1`, [ID_1]);
  assert.equal(fila.estado, 'pendiente');
  assert.equal(fila.foto_aprobada, false);
  assert.equal(fila.foto_entrada, null, 'el trigger tiene que vaciar la entrada');
  assert.equal(fila.bytes, Buffer.from(FOTO, 'base64').length);
  assert.equal(fila.descripcion, 'al lado del canal');
  assert.equal(fila.punto, 'POINT(-58.9839 -27.4606)');
});

test('un reporte pendiente no aparece en el mapa ni entrega foto ni riesgo', async () => {
  assert.deepEqual((await leer(await reportes.GET(pedir('/api/reportes')))).cuerpo, []);
  assert.equal((await leer(await foto.GET(pedir(`/api/foto?id=${ID_1}`)))).cuerpo, null);
  assert.equal((await leer(await riesgo.GET(pedir(`/api/riesgo?id=${ID_1}`)))).cuerpo, null);
});

test('reenviar el mismo reporte (reintento sin señal) da 409 / 23505', async () => {
  const r = await leer(await reportes.POST(postJSON({ id: ID_1, lat: -27.4606, lon: -58.9839 })));
  assert.equal(r.estado, 409);
  assert.equal(r.cuerpo.code, '23505');
});

test('otro reporte a menos de 20 m en 10 minutos da 409 / P0002 con el mensaje de la base', async () => {
  const r = await leer(await reportes.POST(postJSON({ id: ID_2, lat: -27.46061, lon: -58.98391 })));
  assert.equal(r.estado, 409);
  assert.equal(r.cuerpo.code, 'P0002');
  assert.match(r.cuerpo.message, /reporte reciente/);
});

test('fuera del Gran Resistencia lo frena la regla de la tabla', async () => {
  const r = await leer(await reportes.POST(postJSON({ id: ID_2, lat: -34.6037, lon: -58.3816 })));
  assert.equal(r.estado, 422);
  assert.equal(r.cuerpo.code, '23514');
});

test('un tipo inventado lo frena la regla de la tabla', async () => {
  const r = await leer(await reportes.POST(postJSON({ id: ID_2, lat: -27.47, lon: -58.99, tipo: 'nuclear' })));
  assert.equal(r.estado, 422);
  assert.equal(r.cuerpo.code, '23514');
});

test('mandar estado o foto_aprobada no sirve de nada: se descartan', async () => {
  const r = await leer(await reportes.POST(postJSON({
    id: ID_2, lat: -27.47, lon: -58.99, estado: 'verificado', foto_aprobada: true,
    revisado_en: '2026-01-01', nota_admin: 'hola',
  })));
  assert.equal(r.estado, 201);
  const [fila] = await admin('select estado, foto_aprobada, revisado_en, nota_admin from public.reportes where id = $1', [ID_2]);
  assert.deepEqual(fila, { estado: 'pendiente', foto_aprobada: false, revisado_en: null, nota_admin: null });
});

test('pedidos mal formados', async () => {
  const casos = [
    [postJSON('{"id": "roto', {}), 400, 'FORMATO'],
    [postJSON('[1,2,3]'), 400, 'FORMATO'],
    [postJSON({ id: 'no-es-un-uuid', lat: -27.47, lon: -58.99 }), 400, 'FORMATO'],
    [postJSON({ id: ID_3, lat: 'abc', lon: -58.99 }), 400, '22P02'],
    [postJSON({ id: ID_3, lon: -58.99 }), 422, '23502'],
    [pedir('/api/reportes', { method: 'POST', headers: { 'Content-Type': 'text/plain' },
                              body: JSON.stringify({ id: ID_3, lat: -27.47, lon: -58.99 }) }), 415, 'FORMATO'],
    [postJSON({ id: ID_3, lat: -27.47, lon: -58.99, foto_entrada: 'A'.repeat(800_000) }), 413, 'P0003'],
    [pedir('/api/foto?id=nada'), 400, 'FORMATO'],
    [pedir('/api/riesgo'), 400, 'FORMATO'],
  ];
  for (const [pedido, estado, codigo] of casos) {
    const ruta = new URL(pedido.url).pathname;
    const funcion = ruta === '/api/foto' ? foto.GET : ruta === '/api/riesgo' ? riesgo.GET
                  : pedido.method === 'POST' ? reportes.POST : reportes.GET;
    const r = await leer(await funcion(pedido));
    assert.equal(r.estado, estado, `${pedido.method} ${pedido.url} → ${JSON.stringify(r.cuerpo)}`);
    assert.equal(r.cuerpo.code, codigo);
  }
  const [{ n }] = await admin('select count(*)::int as n from public.reportes where id = $1', [ID_3]);
  assert.equal(n, 0, 'ninguno de esos pedidos tiene que haber guardado algo');
});

test('una vez verificado: aparece en el mapa con fecha AAAA-MM-DD, y entrega foto y riesgo', async () => {
  await admin(`update public.reportes set estado = 'verificado', foto_aprobada = true, revisado_en = now()
               where id = $1`, [ID_1]);

  const lista = await leer(await reportes.GET(pedir('/api/reportes')));
  assert.equal(lista.cuerpo.length, 1);
  const [r] = lista.cuerpo;
  assert.equal(r.id, ID_1);
  assert.equal(r.estado, 'verificado');
  assert.equal(r.tiene_foto, true);
  assert.match(r.fecha, /^\d{4}-\d{2}-\d{2}$/, 'el navegador arma la fecha con fecha + "T12:00:00"');
  assert.equal(typeof r.lat, 'number');
  assert.deepEqual(Object.keys(r).sort(),
    ['estado', 'fecha', 'id', 'lat', 'lon', 'quema', 'riesgo_clase', 'riesgo_total', 'tamano', 'tiene_foto', 'tipo'],
    'nada de descripción, foto ni datos de moderación');
  // Se publicó por SQL, sin pasar por el panel: la visita misma calcula el índice que faltaba
  assert.match(r.riesgo_clase, /^(bajo|medio|alto)$/);
  assert.equal(typeof r.riesgo_total, 'number');

  const f = await leer(await foto.GET(pedir(`/api/foto?id=${ID_1}`)));
  assert.equal(f.cuerpo, FOTO);
  assert.match(f.cache, /s-maxage=600/);

  const ri = await leer(await riesgo.GET(pedir(`/api/riesgo?id=${ID_1}`)));
  assert.equal(typeof ri.cuerpo.total, 'number');
  assert.equal(ri.cuerpo.amenaza.fuente, 'relevamiento');
});

test('el satélite completa cada dato por separado: solo quemas -> fuente mixta', async () => {
  // ID_1 (verificado) lo cargó el vecino como camioneta (0,6), con quema y de hace meses (0,7).
  // Para ver cómo se combinan las quemas, se marca un rato sin quema.
  const amenaza = async () => (await leer(await riesgo.GET(pedir(`/api/riesgo?id=${ID_1}`)))).cuerpo.amenaza;
  const solo = (a) => ({ fuente: a.fuente, tamano: a.tamano, quemas: a.quemas, crecimiento: a.crecimiento });

  assert.deepEqual(solo(await amenaza()), { fuente: 'relevamiento', tamano: 0.6, quemas: 1, crecimiento: 0.7 },
    'sin fila satelital, todo sale del vecino');

  await admin('update public.reportes set quema = false where id = $1', [ID_1]);
  try {
    assert.equal((await amenaza()).quemas, 0);

    await admin('insert into public.amenaza_satelital (reporte_id) values ($1)', [ID_1]);
    assert.deepEqual(solo(await amenaza()), { fuente: 'relevamiento', tamano: 0.6, quemas: 0, crecimiento: 0.7 },
      'una fila satelital vacía no cambia nada');

    await admin('update public.amenaza_satelital set quemas_12m = 2 where reporte_id = $1', [ID_1]);
    const a = await amenaza();
    assert.deepEqual(solo(a), { fuente: 'mixta', tamano: 0.6, quemas: 0.5, crecimiento: 0.7 },
      '2 quemas de un tope de 4; tamaño y antigüedad siguen siendo los del vecino');
    assert.equal(a.quemas_12m, 2);

    await admin('update public.reportes set quema = true where id = $1', [ID_1]);
    await admin('update public.amenaza_satelital set quemas_12m = 0 where reporte_id = $1', [ID_1]);
    assert.equal((await amenaza()).quemas, 1, 'si el satélite no ve quemas, no borra la que informó el vecino');

    await admin('update public.amenaza_satelital set area_m2 = 2500, crecimiento_pct = 40 where reporte_id = $1', [ID_1]);
    assert.deepEqual(solo(await amenaza()), { fuente: 'satelite', tamano: 0.5, quemas: 1, crecimiento: 0.4 });
  } finally {
    await admin('delete from public.amenaza_satelital where reporte_id = $1', [ID_1]);
    await admin('update public.reportes set quema = true where id = $1', [ID_1]);
  }
});

test('errores de la base que el trigger levanta a propósito', async () => {
  usarEjecutorDePrueba(async (_rol) => {
    throw Object.assign(new Error('Se alcanzó el límite de reportes por hora. Probá más tarde.'), { code: 'P0001' });
  });
  try {
    const r = await leer(await reportes.POST(postJSON({ id: ID_3, lat: -27.47, lon: -58.99 })));
    assert.equal(r.estado, 429);
    assert.match(r.cuerpo.message, /límite de reportes por hora/);
  } finally {
    usarEjecutorDePrueba(ejecutorLocal);
  }
});

test('un error inesperado no muestra detalles internos y es 5xx (el cliente reintenta)', async () => {
  usarEjecutorDePrueba(async (_rol) => {
    throw Object.assign(new Error('connection to 10.0.0.3 refused, password=xyz'), { code: '08006' });
  });
  const original = console.error;
  console.error = () => {};
  try {
    const r = await leer(await reportes.GET(pedir('/api/reportes')));
    assert.equal(r.estado, 500);
    assert.equal(r.cuerpo.code, 'ERROR_SERVIDOR');
    assert.doesNotMatch(JSON.stringify(r.cuerpo), /10\.0\.0\.3|password/);
  } finally {
    console.error = original;
    usarEjecutorDePrueba(ejecutorLocal);
  }
});

test('sin DATABASE_URL en Vercel responde 503 / SIN_CONFIG', async () => {
  usarEjecutorDePrueba(null);
  const guardada = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const r = await leer(await reportes.GET(pedir('/api/reportes')));
    assert.equal(r.estado, 503);
    assert.equal(r.cuerpo.code, 'SIN_CONFIG');
  } finally {
    if (guardada !== undefined) process.env.DATABASE_URL = guardada;
    usarEjecutorDePrueba(ejecutorLocal);
  }
});

// ---------------------------------------------------------------------
// Topes por origen (desde 2026-11-24)
// ---------------------------------------------------------------------
const desde = (ip) => ({ 'X-Forwarded-For': ip });
// Puntos separados ~110 m entre sí, para no chocar con el control de duplicados
let paso = 0;
const otroPunto = () => { paso += 1; return { lat: -27.55 + paso * 0.001, lon: -58.90 }; };
const altaDesde = async (ip, extra = {}) =>
  leer(await reportes.POST(postJSON({ id: crypto.randomUUID(), ...otroPunto(), ...extra }, desde(ip))));

test('origen: la IP no se guarda; IPv6 cuenta por /64 y el código cambia cada día', async () => {
  assert.equal(normalizarIP('2800:810:4a1:1234:aaaa::1'), normalizarIP('2800:0810:04a1:1234:bbbb:0:0:2'));
  assert.notEqual(normalizarIP('2800:810:4a1:1234::1'), normalizarIP('2800:810:4a1:1235::1'));
  assert.equal(normalizarIP('::ffff:181.1.2.3'), '181.1.2.3');
  const pedido = pedir('/', { headers: desde('181.1.2.3, 10.0.0.1') });
  const hoy = origenDe(pedido, new Date('2026-11-24T12:00:00Z'));
  assert.equal(hoy, origenDe(pedir('/', { headers: desde('181.1.2.3') }), new Date('2026-11-24T20:00:00Z')));
  assert.notEqual(hoy, origenDe(pedido, new Date('2026-11-25T12:00:00Z')));
  assert.ok(!hoy.includes('181'));
  assert.equal(origenDe(pedir('/')), null, 'sin IP (pruebas locales) no hay código');
});

test('origen: 10 reportes por hora desde la misma conexión; otra conexión sigue pudiendo', async () => {
  await admin('truncate public.limite_origen');
  for (let i = 0; i < 10; i++) assert.equal((await altaDesde('181.10.0.1')).estado, 201, `alta ${i + 1}`);
  const once = await altaDesde('181.10.0.1');
  assert.equal(once.estado, 429);
  assert.match(once.cuerpo.message, /desde tu conexión/);
  assert.equal((await altaDesde('181.10.0.2')).estado, 201, 'otra conexión no queda bloqueada');

  const filas = await admin('select * from public.limite_origen');
  assert.equal(filas.length, 11, 'el alta rechazada no deja rastro');
  assert.deepEqual(Object.keys(filas[0]).sort(), ['bytes', 'creado_en', 'origen'], 'sin id de reporte ni IP');
  assert.ok(filas.every((f) => !f.origen.includes('181.10')));
});

test('origen: tope de 3 MB de fotos por hora; sin foto se puede seguir reportando', async () => {
  await admin('truncate public.limite_origen');
  const foto = randomBytes(390_000).toString('base64');  // ~390 KB, debajo del máximo por foto (400 KB)
  for (let i = 0; i < 7; i++) assert.equal((await altaDesde('181.20.0.1', { foto_entrada: foto })).estado, 201);
  const octava = await altaDesde('181.20.0.1', { foto_entrada: foto });
  assert.equal(octava.estado, 429);
  assert.match(octava.cuerpo.message, /muchas fotos/);
  assert.equal((await altaDesde('181.20.0.1')).estado, 201);
});

test('tope diario de fotos entre todos: 150 MB', async () => {
  await admin('truncate public.limite_origen');
  await admin(`insert into public.limite_origen (origen, bytes) values ('otros', 149990000)`);
  const r = await altaDesde('181.30.0.1', { foto_entrada: FOTO.repeat(1000) });
  assert.equal(r.estado, 429);
  assert.match(r.cuerpo.message, /límite de fotos/);
  assert.equal((await altaDesde('181.30.0.1')).estado, 201, 'sin foto entra');
  await admin('truncate public.limite_origen');
});

test('la tabla de orígenes no la puede leer ni tocar el público ni el moderador', async () => {
  for (const rol of ['anonymous', 'moderador']) {
    for (const sql of ['select * from public.limite_origen', 'delete from public.limite_origen',
                       `insert into public.limite_origen (origen) values ('x')`]) {
      await assert.rejects(ejecutorLocal(rol, [[sql, []]]), (e) => e.code === '42501', `${rol}: ${sql}`);
    }
  }
});
