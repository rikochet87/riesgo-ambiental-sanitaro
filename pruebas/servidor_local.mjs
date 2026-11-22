// Sirve la página y /api igual que Vercel (mismas cabeceras, CSP incluida),
// pero contra un Postgres local. Para probar sin desplegar:
//   npm run local      →  http://localhost:8000
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { usarEjecutorDePrueba } from '../api/_db.js';
import { ejecutorLocal } from './_postgres_local.mjs';
import * as reportes from '../api/reportes.js';
import * as foto from '../api/foto.js';
import * as riesgo from '../api/riesgo.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PUERTO = Number(process.env.PORT || 8000);
const FUNCIONES = { '/api/reportes': reportes, '/api/foto': foto, '/api/riesgo': riesgo };
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
// Lo que nunca se sirve (en Vercel lo excluye .vercelignore o no es estático)
const PRIVADO = /(^|[\\/])(node_modules|\.git|api|pruebas|neon|datos|scripts|docs)([\\/]|$)/;

const config = JSON.parse(await readFile(join(RAIZ, 'vercel.json'), 'utf8'));
const CABECERAS = Object.fromEntries(
  (config.headers?.find((h) => h.source === '/(.*)')?.headers || []).map((h) => [h.key, h.value]));

usarEjecutorDePrueba(ejecutorLocal);

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PUERTO}`);

    const modulo = FUNCIONES[url.pathname];
    if (modulo) {
      const manejador = modulo[req.method];
      if (!manejador) { res.writeHead(405, CABECERAS).end(); return; }
      const partes = [];
      for await (const parte of req) partes.push(parte);
      const pedido = new Request(url, {
        method: req.method,
        headers: Object.entries(req.headers).filter(([k]) => !['connection', 'host'].includes(k)),
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(partes),
      });
      const respuesta = await manejador(pedido);
      res.writeHead(respuesta.status, { ...CABECERAS, ...Object.fromEntries(respuesta.headers) });
      res.end(Buffer.from(await respuesta.arrayBuffer()));
      return;
    }

    const relativa = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
    const ruta = normalize(join(RAIZ, relativa));
    if (!ruta.startsWith(RAIZ) || PRIVADO.test(relativa.split('/').join(sep))) {
      res.writeHead(404).end(); return;
    }
    const contenido = await readFile(ruta);
    res.writeHead(200, { ...CABECERAS, 'Content-Type': TIPOS[extname(ruta)] || 'application/octet-stream' });
    res.end(contenido);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' || err.code === 'EISDIR' ? 404 : 500).end();
  }
}).listen(PUERTO, () => console.log(`Página y /api en http://localhost:${PUERTO}`));
