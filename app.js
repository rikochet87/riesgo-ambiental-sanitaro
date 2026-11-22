import { NEON_DATA_API, AREA, CENTRO_INICIAL, ZOOM_INICIAL } from './config.js';

// ---------------------------------------------------------------------
// Data API de Neon (compatible con PostgREST)
// ---------------------------------------------------------------------
// Sin librerías ni claves: el rol anonymous solo puede insertar reportes,
// leer la vista pública y llamar a las dos funciones. Lo permite la base.
const CONFIGURADO = !NEON_DATA_API.includes('TU-PROYECTO');
const API = NEON_DATA_API.replace(/\/+$/, '');

async function api(ruta, opciones = {}) {
  if (!CONFIGURADO) {
    throw Object.assign(new Error('La página todavía no está conectada a la base.'), { code: 'SIN_CONFIG' });
  }
  const res = await fetch(API + ruta, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) },
  });
  if (!res.ok) {
    let cuerpo = {};
    try { cuerpo = await res.json(); } catch { /* la respuesta no trae JSON */ }
    throw Object.assign(new Error(cuerpo.message || `Error ${res.status}`),
                        { code: cuerpo.code, status: res.status });
  }
  if (res.status === 204) return null;
  const texto = await res.text();
  return texto ? JSON.parse(texto) : null;
}

const apiSelect = (vista, consulta) => api(`/${vista}?${consulta}`);
const apiInsert = (tabla, fila) =>
  api(`/${tabla}`, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(fila) });
const apiRpc = (funcion, args) =>
  api(`/rpc/${funcion}`, { method: 'POST', body: JSON.stringify(args) });

const FOTO_LADO_MAX = 1000;      // px
const FOTO_PESO_OBJETIVO = 200_000; // bytes (la foto viaja dentro del reporte)

const COLORES = { verificado: '#e03131', en_gestion: '#f59f00', resuelto: '#2f9e44' };
const NOMBRES_ESTADO = { verificado: 'Activo', en_gestion: 'En gestión', resuelto: 'Resuelto' };
const NOMBRES_TIPO = {
  domiciliario: 'Domiciliario', verde_poda: 'Verde / poda', escombros: 'Escombros',
  neumaticos: 'Neumáticos', mixto: 'Mezcla', otro: 'Otro',
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// Mapa
// ---------------------------------------------------------------------
const mapa = L.map('mapa', { zoomControl: false, attributionControl: false }).setView(CENTRO_INICIAL, ZOOM_INICIAL);
// Créditos arriba a la izquierda: abajo los tapa el panel del botón
L.control.attribution({ position: 'topleft', prefix: false }).addTo(mapa);
// Mapa base claro y de pocos colores, para que resalten los puntos del semáforo
const calles = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  maxZoom: 20,
  subdomains: 'abcd',
  attribution: '&copy; OpenStreetMap &copy; CARTO',
}).addTo(mapa);

const satelite = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 19, attribution: 'Imágenes &copy; Esri' },
);

L.control.layers({ 'Mapa': calles, 'Satélite': satelite }, null, { position: 'topright' }).addTo(mapa);
L.control.zoom({ position: 'topright' }).addTo(mapa);

// La mira va dentro del contenedor del mapa para que su centro sea exacto
mapa.getContainer().appendChild($('mira'));

const capaPublica = L.layerGroup().addTo(mapa);

async function cargarReportesPublicos() {
  if (!CONFIGURADO) return;
  let data;
  try {
    data = await apiSelect('reportes_publicos',
      'select=id,lat,lon,estado,tipo,tamano,quema,fecha,tiene_foto&limit=3000');
  } catch (err) { console.warn('No se pudo cargar el mapa público', err); return; }

  capaPublica.clearLayers();
  for (const r of data) {
    const color = COLORES[r.estado] || '#888';
    const marcador = L.circleMarker([r.lat, r.lon], {
      radius: 10, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1,
    });
    marcador.bindPopup(htmlPopup(r, null), { maxWidth: 300, minWidth: 260, autoPanPadding: [16, 70] });
    marcador.on('popupopen', async () => { await cargarRiesgo(marcador, r); cargarFoto(marcador, r); });
    marcador.addTo(capaPublica);
  }
}

// ---------------------------------------------------------------------
// Popup con índice de riesgo
// ---------------------------------------------------------------------
const cacheRiesgo = new Map();
const cacheFoto = new Map();
const COLOR_CLASE = { bajo: '#2f9e44', medio: '#e8590c', alto: '#e03131' };

async function cargarRiesgo(marcador, r) {
  if (cacheRiesgo.has(r.id)) { marcador.setPopupContent(htmlPopup(r, cacheRiesgo.get(r.id))); return; }
  let riesgo;
  try {
    riesgo = (await apiRpc('riesgo_basural', { p_id: r.id })) || { error: true };
    if (!riesgo.error) cacheRiesgo.set(r.id, riesgo);
  } catch (err) { console.warn('No se pudo calcular el índice', err); riesgo = { error: true }; }
  marcador.setPopupContent(htmlPopup(r, riesgo));
}

// La foto se pide aparte y solo al abrir el popup, para no cargarla en el mapa
async function cargarFoto(marcador, r) {
  if (!r.tiene_foto) return;
  const hueco = marcador.getPopup()?.getElement()?.querySelector('.rz-foto');
  if (!hueco) return;
  try {
    let base64 = cacheFoto.get(r.id);
    if (base64 === undefined) {
      base64 = await apiRpc('foto_basural', { p_id: r.id });
      cacheFoto.set(r.id, base64);
    }
    if (!base64) { hueco.remove(); return; }
    const img = new Image();
    img.alt = 'Foto del basural enviada por un vecino';
    img.src = `data:image/jpeg;base64,${base64}`;
    hueco.replaceChildren(img);
  } catch (err) {
    console.warn('No se pudo cargar la foto', err);
    hueco.textContent = 'No se pudo cargar la foto.';
  }
}

const fmt = (n) => Number(n).toLocaleString('es-AR');

function barra(nombre, puntaje, peso, detalle) {
  const sinDatos = puntaje === null || puntaje === undefined;
  const pct = sinDatos ? 0 : Math.round(puntaje * 100);
  const color = sinDatos ? '#b8c4c6' : pct >= 67 ? '#e03131' : pct >= 34 ? '#f59f00' : '#2f9e44';
  return `
    <div class="rz-comp">
      <div class="rz-fila"><span>${nombre}</span><b>${sinDatos ? 'sin datos' : pct}</b></div>
      <div class="rz-barra"><i style="width:${pct}%;background:${color}"></i></div>
      <div class="rz-det">${detalle}${peso != null ? ` · peso ${Math.round(peso * 100)}%` : ''}</div>
    </div>`;
}

function htmlPopup(r, riesgo) {
  const fecha = new Date(r.fecha + 'T12:00:00').toLocaleDateString('es-AR');
  const tipo = r.tipo ? `${NOMBRES_TIPO[r.tipo] || r.tipo}, reportado el ${fecha}` : `Reportado el ${fecha}`;
  const cabecera = `
    <div class="rz-cab">
      <b><i class="luz" style="display:inline-block;margin-right:7px;vertical-align:1px;background:${COLORES[r.estado] || '#888'}"></i>${NOMBRES_ESTADO[r.estado] || r.estado}</b>
      <span>${tipo}</span>
    </div>`;

  // Hueco para la foto: lo completa cargarFoto() cuando llega la imagen
  const foto = r.tiene_foto ? '<div class="rz-foto">Cargando foto…</div>' : '';

  if (!riesgo) return `<div class="rz">${cabecera}${foto}<p class="rz-cargando">Calculando índice de riesgo…</p></div>`;
  if (riesgo.error) return `<div class="rz">${cabecera}${foto}<p class="rz-cargando">No se pudo calcular el índice ahora.</p></div>`;

  const a = riesgo.amenaza, e = riesgo.exposicion, v = riesgo.vulnerabilidad, rv = riesgo.reportes, w = riesgo.pesos;

  const detAmenaza = a.fuente === 'satelite'
    ? [a.area_m2 != null ? `${fmt(Math.round(a.area_m2))} m²` : null,
       a.quemas_12m != null ? `${a.quemas_12m} quema(s) en 12 meses` : null,
       a.crecimiento_pct != null ? `crece ${fmt(a.crecimiento_pct)}%/año` : null].filter(Boolean).join(', ') + ' (satélite)'
    : 'Estimada con el relevamiento vecinal (aún sin análisis satelital)';

  const detExpo = e.puntaje == null
    ? 'Faltan capas de población y equipamientos'
    : [e.poblacion != null ? `~${fmt(e.poblacion)} personas` : null,
       e.escuelas != null ? `${e.escuelas} escuela(s)` : null,
       e.salud != null ? `${e.salud} centro(s) de salud` : null].filter(Boolean).join(', ') + ` a menos de ${e.radio_m} m`;

  const detVuln = v.puntaje == null
    ? 'Faltan capas de agua y zonas inundables'
    : [v.distancia_agua_m != null
        ? `${v.agua_nombre || v.agua_tipo || 'Curso de agua'} a ${fmt(v.distancia_agua_m)} m`
        : `Sin agua a menos de ${v.radio_agua_m} m`,
       v.zona_inundable === true ? 'en zona inundable' : v.zona_inundable === false ? 'fuera de zona inundable' : null,
      ].filter(Boolean).join(', ');

  const detRep = rv.activos > 0
    ? `${rv.activos} reporte(s) activo(s) a menos de ${rv.radio_m} m; el más antiguo hace ${rv.dias_persistencia} días`
    : `Sin reportes activos a menos de ${rv.radio_m} m`;

  const clase = riesgo.clase || 'sin datos';
  const colorClase = COLOR_CLASE[riesgo.clase] || '#888';

  return `
    <div class="rz">
      ${cabecera}
      ${foto}
      <div class="rz-total" style="border-color:${colorClase}">
        <span class="rz-num" style="color:${colorClase}">${riesgo.total ?? '–'}</span>
        <span>Índice ambiental y sanitario<br><b style="color:${colorClase}">Riesgo ${clase}</b> <small>sobre 100</small></span>
      </div>
      ${barra('Amenaza', a.puntaje, w.amenaza, detAmenaza)}
      ${barra('Exposición', e.puntaje, w.exposicion, detExpo)}
      ${barra('Vulnerabilidad ambiental', v.puntaje, w.vulnerabilidad, detVuln)}
      ${barra('Reportes vecinales', rv.puntaje, w.reportes, detRep)}
      <p class="rz-nota">Índice preliminar: pesos y umbrales en calibración.</p>
    </div>`;
}

// ---------------------------------------------------------------------
// Flujo de denuncia
// ---------------------------------------------------------------------
let ubicacionElegida = null;
let fotoProcesada = null;

function entrarModoUbicacion() {
  document.body.classList.add('eligiendo');
  $('mira').hidden = false;
  $('panel-ubicacion').hidden = false;
  if (mapa.getZoom() < 16) mapa.setZoom(16);
}

function salirModoUbicacion() {
  document.body.classList.remove('eligiendo');
  $('mira').hidden = true;
  $('panel-ubicacion').hidden = true;
}

function dentroDelArea({ lat, lng }) {
  return lat >= AREA.latMin && lat <= AREA.latMax && lng >= AREA.lonMin && lng <= AREA.lonMax;
}

function irAMiUbicacion() {
  if (!navigator.geolocation) { aviso('Tu navegador no permite ubicarte. Mové el mapa a mano.', true); return; }
  const btn = $('btn-gps');
  btn.disabled = true; btn.textContent = 'Buscando…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      mapa.setView([pos.coords.latitude, pos.coords.longitude], 18);
      btn.disabled = false; btn.textContent = 'Mi ubicación';
    },
    () => {
      aviso('No pudimos obtener tu ubicación. Mové el mapa a mano.', true);
      btn.disabled = false; btn.textContent = 'Mi ubicación';
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
  );
}

function confirmarUbicacion() {
  const c = mapa.getCenter();
  if (!dentroDelArea(c)) { aviso('Ese punto está fuera del Gran Resistencia.', true); return; }
  ubicacionElegida = { lat: Number(c.lat.toFixed(6)), lon: Number(c.lng.toFixed(6)) };
  salirModoUbicacion();
  abrirHoja();
}

function abrirHoja() {
  $('ubicacion-texto').textContent =
    `Ubicación: ${ubicacionElegida.lat.toFixed(5)}, ${ubicacionElegida.lon.toFixed(5)}`;
  $('hoja').hidden = false;
  document.body.classList.add('con-hoja');
}

function cerrarHoja() {
  $('hoja').hidden = true;
  document.body.classList.remove('con-hoja');
  $('form').reset();
  $('foto-preview').hidden = true;
  $('foto-preview').removeAttribute('src');
  $('btn-foto-texto').textContent = 'Sacar o elegir foto';
  fotoProcesada = null;
  ubicacionElegida = null;
}

// ---------------------------------------------------------------------
// Foto: se redibuja en un canvas (achica y elimina metadatos/ubicación)
// ---------------------------------------------------------------------
async function leerImagen(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Alternativa para navegadores viejos
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function comprimirFoto(file) {
  const img = await leerImagen(file);
  const w = img.width, h = img.height;
  const k = Math.min(1, FOTO_LADO_MAX / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  if (img.close) img.close();

  let calidad = 0.8;
  let blob;
  do {
    blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', calidad));
    calidad -= 0.15;
  } while (blob && blob.size > FOTO_PESO_OBJETIVO && calidad > 0.3);
  if (!blob) throw new Error('No se pudo procesar la foto');

  // La foto viaja dentro del reporte, en base64: así la guarda la base
  const base64 = await new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result).split(',')[1]);
    lector.onerror = () => mal(lector.error);
    lector.readAsDataURL(blob);
  });
  return { blob, base64 };
}

async function alElegirFoto(e) {
  const file = e.target.files && e.target.files[0];
  fotoProcesada = null;
  $('foto-preview').hidden = true;
  if (!file) return;
  try {
    const procesada = await comprimirFoto(file);
    fotoProcesada = procesada.base64;
    $('foto-preview').src = URL.createObjectURL(procesada.blob);
    $('foto-preview').hidden = false;
    $('btn-foto-texto').textContent = 'Cambiar foto';
  } catch (err) {
    console.error(err);
    e.target.value = '';
    aviso('No pudimos leer esa foto. Probá con otra.', true);
  }
}

// ---------------------------------------------------------------------
// Envío y cola sin señal (IndexedDB)
// ---------------------------------------------------------------------
const DB_NOMBRE = 'basurales';
const DB_STORE = 'pendientes';

function abrirDB() {
  return new Promise((ok, mal) => {
    const req = indexedDB.open(DB_NOMBRE, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE, { keyPath: 'id' });
    req.onsuccess = () => ok(req.result);
    req.onerror = () => mal(req.error);
  });
}

async function operarCola(modo, fn) {
  const db = await abrirDB();
  return new Promise((ok, mal) => {
    const tx = db.transaction(DB_STORE, modo);
    const resultado = fn(tx.objectStore(DB_STORE));
    tx.oncomplete = () => ok(resultado && resultado.result);
    tx.onerror = () => mal(tx.error);
  });
}

const guardarEnCola = (rep) => operarCola('readwrite', (s) => s.put(rep));
const borrarDeCola = (id) => operarCola('readwrite', (s) => s.delete(id));
const listarCola = () => operarCola('readonly', (s) => s.getAll());

function esErrorDeRed(err) {
  if (!navigator.onLine) return true;
  const msg = String((err && (err.message || err.error)) || err || '');
  return /fetch|network|load failed|timeout/i.test(msg) && !(err && err.code);
}

function yaExiste(err) {
  // 23505: el reporte ya está en la base (reintento tras un envío que sí llegó)
  if (!err) return false;
  return err.code === '23505' || err.status === 409 ||
    /already exists|duplicate/i.test(err.message || '');
}

async function enviarReporte(rep) {
  try {
    await apiInsert('reportes', rep.datos);
  } catch (err) {
    if (!yaExiste(err)) throw err;
  }
}

function mensajeDeError(err) {
  if (!err) return 'No se pudo enviar el reporte.';
  // P0001 tope por hora · P0002 duplicado cercano · P0003 foto inválida
  if (['P0001', 'P0002', 'P0003', 'SIN_CONFIG'].includes(err.code)) return err.message;
  if (err.code === '23514') return 'Algún dato no es válido. Revisá la ubicación y los campos.';
  return 'No se pudo enviar el reporte. Probá de nuevo en un rato.';
}

async function alEnviar(e) {
  e.preventDefault();
  const form = e.target;
  const btn = $('btn-enviar');

  // Bot: completó el campo trampa. Simulamos éxito y no enviamos nada.
  if (form.sitio_web.value) { cerrarHoja(); aviso('¡Gracias! Tu reporte fue enviado.'); return; }
  if (!ubicacionElegida) { aviso('Falta elegir la ubicación.', true); return; }

  const id = crypto.randomUUID();
  const datos = {
    id,
    lat: ubicacionElegida.lat,
    lon: ubicacionElegida.lon,
    tipo: form.tipo.value || null,
    tamano: form.tamano.value || null,
    antiguedad: form.antiguedad.value || null,
    quema: form.quema.checked || null,
    cerca_agua: form.cerca_agua.checked || null,
    cerca_escuela: form.cerca_escuela.checked || null,
    descripcion: form.descripcion.value.trim().slice(0, 500) || null,
    foto_entrada: fotoProcesada,   // base64; la base la convierte y la vacía
  };
  const rep = { id, datos, guardado_en: Date.now() };

  btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    await enviarReporte(rep);
    cerrarHoja();
    aviso('¡Gracias! Tu reporte queda pendiente de revisión.');
  } catch (err) {
    console.error(err);
    if (esErrorDeRed(err)) {
      await guardarEnCola(rep);
      cerrarHoja();
      aviso('Sin conexión: guardamos el reporte y se enviará solo cuando vuelva la señal.');
      actualizarAvisoPendientes();
    } else {
      aviso(mensajeDeError(err), true);
    }
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar reporte';
  }
}

let reintentando = false;
async function reintentarPendientes() {
  if (reintentando || !CONFIGURADO || !navigator.onLine) return;
  reintentando = true;
  try {
    const pendientes = await listarCola();
    let enviados = 0;
    for (const rep of pendientes) {
      try {
        await enviarReporte(rep);
        await borrarDeCola(rep.id);
        enviados++;
      } catch (err) {
        if (esErrorDeRed(err)) break;           // sigue sin señal: probamos después
        console.warn('Reporte rechazado, se descarta', err);
        await borrarDeCola(rep.id);             // rechazado por la base: no insistir
      }
    }
    if (enviados) aviso(`Se enviaron ${enviados} reporte(s) guardado(s).`);
  } finally {
    reintentando = false;
    actualizarAvisoPendientes();
  }
}

async function actualizarAvisoPendientes() {
  try {
    const n = (await listarCola()).length;
    const el = $('pendientes');
    el.hidden = n === 0;
    el.textContent = n === 1 ? '1 reporte esperando señal' : `${n} reportes esperando señal`;
  } catch { /* IndexedDB no disponible (modo privado): no mostramos nada */ }
}

// ---------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------
let temporizadorAviso;
function aviso(texto, esError = false) {
  const t = $('toast');
  t.textContent = texto;
  t.classList.toggle('error', esError);
  t.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { t.hidden = true; }, esError ? 5000 : 4000);
}

// ---------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------
$('btn-denunciar').addEventListener('click', entrarModoUbicacion);
$('btn-gps').addEventListener('click', irAMiUbicacion);
$('btn-cancelar-ubic').addEventListener('click', salirModoUbicacion);
$('btn-confirmar-ubic').addEventListener('click', confirmarUbicacion);
$('btn-cerrar').addEventListener('click', cerrarHoja);
$('foto').addEventListener('change', alElegirFoto);
$('form').addEventListener('submit', alEnviar);
$('btn-info').addEventListener('click', () => $('dlg-info').showModal());
window.addEventListener('online', reintentarPendientes);

if (!CONFIGURADO) {
  console.warn('Completá config.js con la URL de la Data API de tu proyecto de Neon.');
}

cargarReportesPublicos();
reintentarPendientes();
actualizarAvisoPendientes();
