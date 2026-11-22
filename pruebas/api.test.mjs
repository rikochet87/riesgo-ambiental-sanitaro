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
});
after(async () => {
  await admin('truncate public.reportes cascade');
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
    ['estado', 'fecha', 'id', 'lat', 'lon', 'quema', 'tamano', 'tiene_foto', 'tipo'],
    'nada de descripción, foto ni datos de moderación');

  const f = await leer(await foto.GET(pedir(`/api/foto?id=${ID_1}`)));
  assert.equal(f.cuerpo, FOTO);
  assert.match(f.cache, /s-maxage=600/);

  const ri = await leer(await riesgo.GET(pedir(`/api/riesgo?id=${ID_1}`)));
  assert.equal(typeof ri.cuerpo.total, 'number');
  assert.equal(ri.cuerpo.amenaza.fuente, 'relevamiento');
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
