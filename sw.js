const PREFIJO = 'basurales-publico-';
const CACHE = PREFIJO + '1';
const BASE = [
  '/', '/styles.css', '/temas/tema-monte.css', '/app.js', '/config.js', '/indice.js',
  '/pwa.js', '/manifest.webmanifest', '/img/app-192.png', '/img/app-512.png',
];
const LEAFLET = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(BASE.map((ruta) => new Request(ruta, { cache: 'reload' })));
    await Promise.allSettled(LEAFLET.map((ruta) => cache.add(ruta)));
  })());
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres.filter((nombre) => nombre.startsWith(PREFIJO) && nombre !== CACHE)
      .map((nombre) => caches.delete(nombre)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);

  // Solo se guarda la interfaz pública. Los datos y las teselas siguen usando la red.
  if (url.origin === self.location.origin) {
    const inicio = pedido.mode === 'navigate' && ['/', '/index.html'].includes(url.pathname);
    const ruta = inicio ? '/' : url.pathname;
    if ((!inicio && pedido.mode === 'navigate') || !BASE.includes(ruta)) return;
    evento.respondWith(fetch(pedido).catch(async () => {
      const cache = await caches.open(CACHE);
      return await cache.match(ruta) || Response.error();
    }));
  } else if (LEAFLET.includes(url.href)) {
    evento.respondWith(caches.open(CACHE).then(async (cache) =>
      await cache.match(pedido) || fetch(pedido)));
  }
});
