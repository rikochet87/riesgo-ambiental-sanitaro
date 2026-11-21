import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, AREA, CENTRO_INICIAL, ZOOM_INICIAL } from './config.js';

// ---------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------
const CONFIGURADO = !SUPABASE_URL.includes('TU-PROYECTO') && !SUPABASE_ANON_KEY.includes('TU-CLAVE');
const sb = CONFIGURADO
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  : null;

const FOTO_LADO_MAX = 1280;      // px
const FOTO_PESO_OBJETIVO = 300_000; // bytes

const COLORES = { verificado: '#d93025', en_gestion: '#f2a900', resuelto: '#1e8e3e' };
const NOMBRES_ESTADO = { verificado: 'Activo', en_gestion: 'En gestión', resuelto: 'Resuelto' };
const NOMBRES_TIPO = {
  domiciliario: 'Domiciliario', verde_poda: 'Verde / poda', escombros: 'Escombros',
  neumaticos: 'Neumáticos', mixto: 'Mezcla', otro: 'Otro',
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// Mapa
// ---------------------------------------------------------------------
const mapa = L.map('mapa', { zoomControl: false }).setView(CENTRO_INICIAL, ZOOM_INICIAL);
L.control.zoom({ position: 'bottomright' }).addTo(mapa);

const calles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap',
}).addTo(mapa);

const satelite = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 19, attribution: 'Imágenes &copy; Esri' },
);

L.control.layers({ 'Calles': calles, 'Satélite': satelite }, null, { position: 'topright' }).addTo(mapa);

// La mira va dentro del contenedor del mapa para que su centro sea exacto
mapa.getContainer().appendChild($('mira'));

const capaPublica = L.layerGroup().addTo(mapa);

async function cargarReportesPublicos() {
  if (!sb) return;
  const { data, error } = await sb
    .from('reportes_publicos')
    .select('id, lat, lon, estado, tipo, tamano, quema, fecha')
    .limit(3000);
  if (error) { console.warn('No se pudo cargar el mapa público', error); return; }

  capaPublica.clearLayers();
  for (const r of data) {
    const color = COLORES[r.estado] || '#888';
    const marcador = L.circleMarker([r.lat, r.lon], {
      radius: 9, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.95,
    });
    marcador.bindPopup(htmlPopup(r, null), { maxWidth: 300, minWidth: 260, autoPanPadding: [16, 70] });
    marcador.on('popupopen', () => cargarRiesgo(marcador, r));
    marcador.addTo(capaPublica);
  }
}

// ---------------------------------------------------------------------
// Popup con índice de riesgo
// ---------------------------------------------------------------------
const cacheRiesgo = new Map();
const COLOR_CLASE = { bajo: '#1e8e3e', medio: '#f2a900', alto: '#d93025' };

async function cargarRiesgo(marcador, r) {
  if (cacheRiesgo.has(r.id)) { marcador.setPopupContent(htmlPopup(r, cacheRiesgo.get(r.id))); return; }
  const { data, error } = await sb.rpc('riesgo_basural', { p_id: r.id });
  const riesgo = error ? { error: true } : (data || { error: true });
  if (!error) cacheRiesgo.set(r.id, riesgo);
  marcador.setPopupContent(htmlPopup(r, riesgo));
}

const fmt = (n) => Number(n).toLocaleString('es-AR');

function barra(nombre, puntaje, peso, detalle) {
  const sinDatos = puntaje === null || puntaje === undefined;
  const pct = sinDatos ? 0 : Math.round(puntaje * 100);
  const color = sinDatos ? '#b4b2a9' : pct >= 67 ? '#d93025' : pct >= 34 ? '#f2a900' : '#1e8e3e';
  return `
    <div class="rz-comp">
      <div class="rz-fila"><span>${nombre}</span><b>${sinDatos ? 'sin datos' : pct}</b></div>
      <div class="rz-barra"><i style="width:${pct}%;background:${color}"></i></div>
      <div class="rz-det">${detalle}${peso != null ? ` · peso ${Math.round(peso * 100)}%` : ''}</div>
    </div>`;
}

function htmlPopup(r, riesgo) {
  const cabecera = `
    <div class="rz-cab">
      <b>${NOMBRES_ESTADO[r.estado] || r.estado}</b>
      <span>${r.tipo ? (NOMBRES_TIPO[r.tipo] || r.tipo) + ' · ' : ''}reportado el
      ${new Date(r.fecha + 'T12:00:00').toLocaleDateString('es-AR')}</span>
    </div>`;

  if (!riesgo) return `<div class="rz">${cabecera}<p class="rz-cargando">Calculando índice de riesgo…</p></div>`;
  if (riesgo.error) return `<div class="rz">${cabecera}<p class="rz-cargando">No se pudo calcular el índice ahora.</p></div>`;

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
      <div class="rz-total" style="border-color:${colorClase}">
        <span class="rz-num" style="color:${colorClase}">${riesgo.total ?? '–'}</span>
        <span>Riesgo ambiental y sanitario<br><b style="color:${colorClase}">${clase.toUpperCase()}</b> <small>(0–100)</small></span>
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
  return blob;
}

async function alElegirFoto(e) {
  const file = e.target.files && e.target.files[0];
  fotoProcesada = null;
  $('foto-preview').hidden = true;
  if (!file) return;
  try {
    fotoProcesada = await comprimirFoto(file);
    $('foto-preview').src = URL.createObjectURL(fotoProcesada);
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
  // 23505: el reporte ya está en la base (reintento). 409: la foto ya se subió.
  if (!err) return false;
  return err.code === '23505' || String(err.statusCode) === '409' ||
    /already exists|duplicate/i.test(err.message || '');
}

async function enviarReporte(rep) {
  if (!sb) throw Object.assign(new Error('La página todavía no está conectada a la base.'), { code: 'SIN_CONFIG' });

  if (rep.foto) {
    const { error } = await sb.storage
      .from('fotos')
      .upload(rep.datos.foto_path, rep.foto, { contentType: 'image/jpeg', upsert: false });
    if (error && !yaExiste(error)) throw error;
  }

  const { error } = await sb.from('reportes').insert(rep.datos);
  if (error && !yaExiste(error)) throw error;
}

function mensajeDeError(err) {
  if (!err) return 'No se pudo enviar el reporte.';
  if (err.code === 'P0001' || err.code === 'P0002' || err.code === 'SIN_CONFIG') return err.message;
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
    foto_path: fotoProcesada ? `reportes/${id}.jpg` : null,
  };
  const rep = { id, datos, foto: fotoProcesada, guardado_en: Date.now() };

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
  if (reintentando || !sb || !navigator.onLine) return;
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
  console.warn('Completá config.js con la URL y la clave anon de Supabase.');
}

cargarReportesPublicos();
reintentarPendientes();
actualizarAvisoPendientes();
