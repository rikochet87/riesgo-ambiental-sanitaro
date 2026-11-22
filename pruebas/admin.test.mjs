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

test('el rol moderador, aunque el código fallara, no puede borrar ni mover un reporte', async () => {
  for (const sql of ['delete from public.reportes', 'update public.reportes set lat = -27.0',
                     'update public.reportes set descripcion = $$x$$', 'select * from public.admin_intentos']) {
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

test('salir vence la cookie', async () => {
  const r = await leer(await entrar.DELETE(pedir('/api/admin/entrar', { metodo: 'DELETE' })));
  assert.match(r.cookie, /Max-Age=0/);
});
