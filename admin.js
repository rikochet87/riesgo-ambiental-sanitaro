// Panel de moderación. Todo lo que muestra viene de /api/admin, que exige la
// sesión del moderador. Lo que escribió el vecino se muestra siempre como texto
// (textContent), nunca como HTML.
import { armarZip } from './admin-zip.js';
import { htmlIndice } from './indice.js';

// "en_gestion" quedó en desuso (2026-11-24): si apareciera, cuenta como activo
const ESTADOS = {
  pendiente: 'Pendiente', verificado: 'Activo', en_gestion: 'Activo',
  resuelto: 'Ya no está', descartado: 'Descartado',
};
const TIPOS = {
  domiciliario: 'Domiciliario', verde_poda: 'Poda', escombros: 'Escombros',
  neumaticos: 'Neumáticos', mixto: 'Mezcla', otro: 'Otro',
};
const TAMANOS = {
  bolsas: 'Unas bolsas', carretilla: 'Una carretilla', camioneta: 'Una camioneta', camion_o_mas: 'Un camión o más',
};
const ANTIGUEDADES = { dias: 'Días', semanas: 'Semanas', meses: 'Meses', mas_de_un_anio: 'Más de un año', no_se: 'No sabe' };

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// Conexión
// ---------------------------------------------------------------------
async function api(ruta, opciones = {}) {
  const res = await fetch('/api/admin' + ruta, {
    ...opciones,
    credentials: 'same-origin',
    headers: { ...(opciones.body && { 'Content-Type': 'application/json' }), ...(opciones.headers || {}) },
  });
  let cuerpo = null;
  try { cuerpo = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) {
    throw Object.assign(new Error(cuerpo?.message || `Error ${res.status}`), { code: cuerpo?.code, status: res.status });
  }
  return cuerpo;
}

let temporizador;
function aviso(texto, esError = false) {
  const t = $('toast');
  t.textContent = texto;
  t.classList.toggle('error', esError);
  t.hidden = false;
  clearTimeout(temporizador);
  temporizador = setTimeout(() => { t.hidden = true; }, esError ? 6000 : 4000);
}

// ---------------------------------------------------------------------
// Entrada y salida
// ---------------------------------------------------------------------
function mostrarEntrada(mensaje = '') {
  $('panel').hidden = true;
  $('btn-salir').hidden = true;
  $('entrada').hidden = false;
  const error = $('error-entrada');
  error.textContent = mensaje;
  error.hidden = !mensaje;
  $('form-entrada').clave.focus();
}

function mostrarPanel() {
  $('entrada').hidden = true;
  $('panel').hidden = false;
  $('btn-salir').hidden = false;
}

// Si la sesión venció a mitad de algo, volver a pedir la clave
function siSeCortoLaSesion(err) {
  if (err.status === 401) { mostrarEntrada('La sesión venció. Entrá de nuevo.'); return true; }
  if (err.code === 'ADMIN_SIN_CONFIG') { mostrarEntrada(err.message); return true; }
  return false;
}

$('form-entrada').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = $('btn-entrar');
  btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    await api('/entrar', { method: 'POST', body: JSON.stringify({ clave: form.clave.value }) });
    form.clave.value = '';
    await cargarTodo();
  } catch (err) {
    mostrarEntrada(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
});

$('btn-salir').addEventListener('click', async () => {
  try { await api('/entrar', { method: 'DELETE' }); } catch { /* igual se sale */ }
  reportes = [];
  seleccionado = null;
  cacheIndice.clear();
  if (mapa) cerrarPopup();
  capaPuntos?.clearLayers();
  anillo?.remove();
  $('lista').replaceChildren();
  $('ficha').replaceChildren();
  mostrarEntrada();
});

// ---------------------------------------------------------------------
// Visor: todos los reportes en el mapa, en sus coordenadas exactas
// ---------------------------------------------------------------------
const COLORES = { pendiente: '#3b5bdb', resuelto: '#b3a68f', descartado: '#868e96' };
// Activos: color por clase de riesgo y tamaño por tamaño del basural, como en el mapa público
// Los mismos tonos del mapa público (los del tema)
const tema = getComputedStyle(document.documentElement);
const colorTema = (variable, porDefecto) => tema.getPropertyValue(variable).trim() || porDefecto;
const COLOR_RIESGO = {
  alto: colorTema('--rojo', '#e03131'), medio: colorTema('--ambar', '#f59f00'), bajo: colorTema('--verde', '#2f9e44'),
};
const SIN_CALCULAR = '#8a9496';
const RADIO_TAMANO = { bolsas: 5, carretilla: 6.5, camioneta: 8.5, camion_o_mas: 11.5 };
const esActivo = (r) => r.estado === 'verificado' || r.estado === 'en_gestion';
// Orden de dibujo: lo que hay que revisar queda arriba de todo
const ORDEN_DIBUJO = ['descartado', 'resuelto', 'en_gestion', 'verificado', 'pendiente'];
const CENTRO = [-27.4606, -58.9839];
const ALTO_HOJA_BAJA = 118;

let reportes = [];
let cantidades = {};
let seleccionado = null;
let copiaAtrasada = false;
const visibles = new Set(['pendiente', 'verificado']);   // "ya no están" y descartados, apagados
// en_gestion (en desuso) sigue a la capa de activos
const capaDe = (estado) => (estado === 'en_gestion' ? 'verificado' : estado);
const seVe = (r) => visibles.has(capaDe(r.estado));
let mapa = null;
let capaPuntos = null;
let anillo = null;
let yaEncuadrado = false;
let popupIndice = null;
const cacheIndice = new Map();

const esCelular = () => matchMedia('(max-width: 899.98px)').matches;
const formatoCorto = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

function crearMapa() {
  if (mapa) return;
  mapa = L.map('visor', { zoomControl: false, attributionControl: false, preferCanvas: true }).setView(CENTRO, 13);
  L.control.attribution({ position: 'topleft', prefix: false }).addTo(mapa);
  const calles = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Mapa &copy; Esri &mdash; &copy; OpenStreetMap' },
  ).addTo(mapa);
  const satelite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Imágenes &copy; Esri' },
  );
  L.control.layers({ Mapa: calles, 'Satélite': satelite }, null, { position: 'topright' }).addTo(mapa);
  L.control.zoom({ position: 'topright' }).addTo(mapa);
  capaPuntos = L.layerGroup().addTo(mapa);
}

async function cargarTodo({ alAbrir = false } = {}) {
  const todos = [];
  try {
    for (let pagina = 0; ; pagina++) {
      const datos = await api(`/reportes?estado=todos&pagina=${pagina}`);
      if (pagina === 0) { cantidades = datos.cantidades; pintarCopia(datos.ultima_copia); }
      todos.push(...datos.reportes);
      if (!datos.hay_mas) break;
    }
  } catch (err) {
    // Al abrir la página sin sesión no "venció" nada: solo pedir la clave
    if (alAbrir && err.status === 401) { mostrarEntrada(); return; }
    if (!siSeCortoLaSesion(err)) aviso('No se pudieron cargar los reportes. ' + err.message, true);
    return;
  }
  reportes = todos;
  mostrarPanel();
  crearMapa();
  mapa.invalidateSize();
  pintarCantidades();
  dibujarPuntos();
  pintarLista();
  if (!yaEncuadrado) { encuadrar(); yaEncuadrado = true; }
}

function encuadrar() {
  const puntos = reportes.filter(seVe).map((r) => [r.lat, r.lon]);
  if (!puntos.length) return;
  mapa.fitBounds(puntos, {
    maxZoom: 15, paddingTopLeft: [40, 40], paddingBottomRight: [40, esCelular() ? ALTO_HOJA_BAJA + 30 : 40],
  });
}

function dibujarPuntos() {
  capaPuntos.clearLayers();
  for (const estado of ORDEN_DIBUJO) {
    if (!visibles.has(capaDe(estado))) continue;
    const delEstado = reportes.filter((r) => r.estado === estado);
    // Activos: los grandes primero, para que los chicos queden arriba y se puedan tocar
    if (estado === 'verificado' || estado === 'en_gestion') delEstado.sort((a, b) => radioActivo(b) - radioActivo(a));
    for (const r of delEstado) {
      const pendiente = estado === 'pendiente';
      const descartado = estado === 'descartado';
      const activo = esActivo(r);
      const punto = L.circleMarker([r.lat, r.lon], {
        radius: pendiente ? 9 : activo ? radioActivo(r) : 6,
        weight: pendiente ? 3 : 2,
        color: descartado ? COLORES.descartado : '#fff',
        fillColor: activo ? (COLOR_RIESGO[r.riesgo_clase] || SIN_CALCULAR) : COLORES[estado],
        fillOpacity: descartado ? 0.3 : estado === 'resuelto' ? 0.7 : 1,
        dashArray: activo && !(r.tamano_moderado || r.tamano) ? '3 3' : null,
      });
      const riesgo = activo && r.riesgo_clase ? `, riesgo ${r.riesgo_clase}` : '';
      punto.bindTooltip(`${ESTADOS[estado]}${riesgo}, ${formatoCorto.format(new Date(r.creado_en))}`,
        { direction: 'top', offset: [0, -8], className: 'etiqueta-reporte' });
      punto.on('click', () => seleccionar(r.id, { desdeMapa: true }));
      punto.addTo(capaPuntos);
    }
  }
  marcarSeleccion();
}

function radioActivo(r) {
  return RADIO_TAMANO[r.tamano_moderado || r.tamano] || 7;
}

// Después de moderar o eliminar: el servidor devuelve las clases de riesgo guardadas
function actualizarRiesgos(riesgos) {
  if (!Array.isArray(riesgos)) return;
  const clase = new Map(riesgos.map((x) => [x.id, x.clase]));
  for (const r of reportes) r.riesgo_clase = clase.get(r.id) ?? null;
}

function marcarSeleccion() {
  anillo?.remove();
  anillo = null;
  const r = reportes.find((x) => x.id === seleccionado);
  if (!r) return;
  anillo = L.circleMarker([r.lat, r.lon], {
    radius: 16, weight: 3, color: '#1b2418', fill: false, interactive: false,
  }).addTo(mapa);
}

// Capas por estado: se prenden y apagan
document.querySelectorAll('.filtros button').forEach((b) => b.addEventListener('click', () => {
  const estado = b.dataset.estado;
  if (visibles.has(estado)) visibles.delete(estado); else visibles.add(estado);
  b.setAttribute('aria-pressed', String(visibles.has(estado)));
  dibujarPuntos();
  pintarLista();
}));

function pintarCantidades() {
  for (const el of document.querySelectorAll('[data-n]')) el.textContent = cantidades[el.dataset.n] ?? 0;
  pintarResumen();
}

function pintarResumen() {
  const n = cantidades.pendiente || 0;
  let texto = n === 0 ? 'No hay reportes para revisar' : n === 1 ? '1 reporte para revisar' : `${n} reportes para revisar`;
  if (copiaAtrasada) texto += ', copia de seguridad atrasada';
  $('resumen').textContent = texto;
}

function pintarLista() {
  const filas = reportes.filter(seVe);
  $('lista').replaceChildren(...filas.map(fila));
  $('vacio').hidden = filas.length > 0;
  $('vacio').textContent = reportes.length ? 'No hay reportes en las capas prendidas.' : 'Todavía no llegó ningún reporte.';
}

function fila(r) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'fila';
  boton.dataset.estado = r.estado;
  boton.dataset.id = r.id;
  // Activos: el punto de la fila con el color de su riesgo, como en el mapa
  if (esActivo(r)) boton.style.setProperty('--color', COLOR_RIESGO[r.riesgo_clase] || SIN_CALCULAR);
  const titulo = document.createElement('span');
  titulo.className = 'fila-titulo';
  titulo.textContent = esActivo(r) && r.riesgo_clase ? `Activo, riesgo ${r.riesgo_clase}` : ESTADOS[r.estado];
  const fecha = document.createElement('time');
  fecha.dateTime = r.creado_en;
  fecha.textContent = formatoCorto.format(new Date(r.creado_en));
  const detalle = document.createElement('span');
  detalle.className = 'fila-detalle';
  const tam = r.tamano_moderado || r.tamano;
  detalle.textContent = [r.tipo && TIPOS[r.tipo], tam && TAMANOS[tam],
    r.tiene_foto && 'con foto', r.quema && 'lo queman'].filter(Boolean).join(', ') || 'Sin datos del lugar';
  boton.append(document.createElement('i'), titulo, fecha, detalle);
  boton.addEventListener('click', () => seleccionar(r.id));
  const li = document.createElement('li');
  li.append(boton);
  return li;
}

// Hoja del celular: baja (solo capas), media (ficha con el mapa a la vista) o alta (lista)
function altura(valor) {
  $('lateral').dataset.altura = valor;
  $('asa').setAttribute('aria-expanded', String(valor !== 'baja'));
}
$('asa').addEventListener('click', () => altura($('lateral').dataset.altura === 'baja' ? 'alta' : 'baja'));

// Pone el punto en el centro de la parte del mapa que no tapa la hoja
function centrarEn(r, { acercar, animar = true }) {
  const zoom = acercar ? Math.max(mapa.getZoom(), 16) : mapa.getZoom();
  let tapado = 0;
  if (esCelular()) {
    const panel = $('panel').clientHeight;
    const valor = $('lateral').dataset.altura;
    tapado = valor === 'media' ? panel * 0.6 : valor === 'alta' ? panel * 0.86 : ALTO_HOJA_BAJA;
  }
  const centro = mapa.project([r.lat, r.lon], zoom).add([0, tapado / 2]);
  mapa.setView(mapa.unproject(centro, zoom), zoom, { animate: animar });
}

// ---------------------------------------------------------------------
// Popup con el índice de riesgo (el mismo bloque que el mapa público)
// ---------------------------------------------------------------------
const formatoDia = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short' });

function cabeceraPopup(r) {
  const fecha = formatoDia.format(new Date(r.creado_en));
  const tipo = r.tipo && TIPOS[r.tipo] ? `${TIPOS[r.tipo]}, reportado el ${fecha}` : `Reportado el ${fecha}`;
  return `<div class="rz-cab"><b><i class="luz" style="display:inline-block;margin-right:7px;vertical-align:1px;`
    + `background:${COLORES[r.estado]}"></i>${ESTADOS[r.estado]}</b><span>${tipo}</span></div>`;
}

// La versión del panel calcula también pendientes y descartados
async function pedirIndice(id) {
  try {
    return (await api(`/riesgo?id=${encodeURIComponent(id)}`)) || { error: true };
  } catch (err) {
    siSeCortoLaSesion(err);
    return { error: true };
  }
}

function abrirPopup(r, { conBotonModerar = false } = {}) {
  // Como elemento y no como texto: al llegar el índice se actualiza sin rearmar el popup
  const nodo = document.createElement('div');
  nodo.className = 'rz';
  const pintar = (riesgo) => {
    nodo.innerHTML = cabeceraPopup(r) + htmlIndice(riesgo);
    if (conBotonModerar) {
      const boton = document.createElement('button');
      boton.className = 'btn-petroleo ancho btn-moderar';
      boton.textContent = 'Moderar este reporte';
      boton.addEventListener('click', () => seleccionar(r.id));
      nodo.append(boton);
    }
  };
  pintar(cacheIndice.get(r.id) ?? null);
  popupIndice = L.popup({
    maxWidth: 300, minWidth: 260, offset: [0, -4],
    autoPanPaddingTopLeft: [16, 16], autoPanPaddingBottomRight: [16, esCelular() ? ALTO_HOJA_BAJA + 16 : 16],
  }).setLatLng([r.lat, r.lon]).setContent(nodo).openOn(mapa);

  if (!cacheIndice.has(r.id)) {
    pedirIndice(r.id).then((riesgo) => {
      if (!riesgo.error) cacheIndice.set(r.id, riesgo);
      if (popupIndice && popupIndice.getContent() === nodo && mapa.hasLayer(popupIndice)) {
        pintar(riesgo);
        popupIndice.update();
      }
    });
  }
}

function cerrarPopup() {
  if (popupIndice) mapa.closePopup(popupIndice);
  popupIndice = null;
}

// ---------------------------------------------------------------------
// Elegir un reporte
// ---------------------------------------------------------------------
function abrirFicha(r) {
  $('ficha').replaceChildren(tarjeta(r));
  $('vista-lista').hidden = true;
  $('vista-ficha').hidden = false;
  $('vista-ficha').scrollTop = 0;
}

function seleccionar(id, { desdeMapa = false } = {}) {
  const r = reportes.find((x) => x.id === id);
  if (!r) return;
  seleccionado = id;
  marcarSeleccion();

  if (esCelular()) {
    // En el celular no entran popup y ficha juntos: tocar un punto muestra el
    // índice, y "Moderar este reporte" abre la ficha
    if (desdeMapa) { abrirPopup(r, { conBotonModerar: true }); return; }
    cerrarPopup();
    abrirFicha(r);
    altura('media');
    centrarEn(r, { acercar: true });
    return;
  }

  // En la compu: ficha en el panel y popup con el índice sobre el mapa
  abrirFicha(r);
  if (!desdeMapa) centrarEn(r, { acercar: true, animar: false });
  abrirPopup(r);
}

function volverALista() {
  seleccionado = null;
  cerrarPopup();
  marcarSeleccion();
  $('vista-ficha').hidden = true;
  $('ficha').replaceChildren();
  $('vista-lista').hidden = false;
  pintarLista();
  if (esCelular()) altura('alta');
}
$('btn-volver').addEventListener('click', volverALista);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Primero se cancela la confirmación de eliminar, si está abierta
  const confirmacion = document.querySelector('#ficha .confirmar-eliminar:not([hidden])');
  if (confirmacion) { cerrarConfirmacion(confirmacion.closest('.tarjeta')); return; }
  if (!$('vista-ficha').hidden) volverALista();
});

const formatoFecha = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

function tarjeta(r) {
  const el = $('plantilla-tarjeta').content.firstElementChild.cloneNode(true);
  el.dataset.id = r.id;
  pintarEstado(el, r);

  const fecha = el.querySelector('.fecha');
  fecha.dateTime = r.creado_en;
  fecha.textContent = formatoFecha.format(new Date(r.creado_en));
  el.querySelector('.ubicacion').href =
    `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon}`;

  const datos = [
    r.tipo && TIPOS[r.tipo], r.tamano && `${TAMANOS[r.tamano]} (según el vecino)`,
    r.antiguedad && `Desde hace: ${ANTIGUEDADES[r.antiguedad]}`,
  ].filter(Boolean).map((t) => [t, false]);
  if (r.quema) datos.push(['Lo queman', true]);
  if (r.cerca_agua) datos.push(['Canal, laguna o zanja', true]);
  if (r.cerca_escuela) datos.push(['Escuela o centro de salud', true]);
  if (!datos.length) datos.push(['Sin datos del lugar', false]);
  el.querySelector('.datos').replaceChildren(...datos.map(([texto, alerta]) => {
    const li = document.createElement('li');
    li.textContent = texto;
    if (alerta) li.className = 'alerta';
    return li;
  }));

  const desc = el.querySelector('.descripcion');
  if (r.descripcion) { desc.textContent = r.descripcion; desc.hidden = false; }
  pintarTamano(el, r);
  el.querySelector('.nota textarea').value = r.nota_admin || '';
  el.querySelector('.nota').open = Boolean(r.nota_admin);

  pintarFoto(el, r);
  el.addEventListener('click', (e) => {
    const boton = e.target.closest('[data-accion]');
    if (boton) accion(el, r, boton);
  });
  return el;
}

// Corrección del tamaño: la primera opción recuerda lo que dijo el vecino
function pintarTamano(el, r) {
  const sel = el.querySelector('.tamano-moderado select');
  sel.options[0].textContent = r.tamano ? `Como dijo el vecino (${TAMANOS[r.tamano].toLowerCase()})`
    : 'Como dijo el vecino (no lo indicó)';
  sel.value = r.tamano_moderado || '';
}

function pintarEstado(el, r) {
  el.dataset.estado = r.estado;
  const estado = el.querySelector('.estado');
  estado.dataset.estado = r.estado;
  estado.textContent = ESTADOS[r.estado];
  el.querySelector('.acciones-revisado select').value = r.estado;
}

function pintarFoto(el, r) {
  const hueco = el.querySelector('.foto');
  const casillas = el.querySelectorAll('.con-foto');
  hueco.hidden = !r.tiene_foto;
  el.querySelector('.btn-quitar').hidden = !r.tiene_foto;
  casillas.forEach((c) => { c.hidden = !r.tiene_foto; });
  el.querySelector('.acciones-revisado .con-foto input').checked = r.foto_aprobada;
  if (r.tiene_foto && !hueco.querySelector('img')) observadorDeFotos.observe(hueco);
}

// Las fotos se piden recién cuando la tarjeta aparece en pantalla
const observadorDeFotos = new IntersectionObserver((entradas) => {
  for (const { isIntersecting, target } of entradas) {
    if (!isIntersecting) continue;
    observadorDeFotos.unobserve(target);
    cargarFoto(target);
  }
}, { rootMargin: '300px' });

async function cargarFoto(hueco) {
  const id = hueco.closest('.tarjeta').dataset.id;
  try {
    const base64 = await api(`/foto?id=${encodeURIComponent(id)}`);
    if (!base64) { hueco.hidden = true; return; }
    const img = new Image();
    img.alt = 'Foto enviada por el vecino';
    img.src = `data:image/jpeg;base64,${base64}`;
    hueco.replaceChildren(img);
  } catch (err) {
    if (!siSeCortoLaSesion(err)) hueco.textContent = 'No se pudo cargar la foto.';
  }
}

// ---------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------
// Eliminar pide confirmación dentro de la ficha. El foco va a "Cancelar":
// un Enter o un toque apurado no borran nada.
function abrirConfirmacion(el) {
  const caja = el.querySelector('.confirmar-eliminar');
  caja.querySelector('.sin-copia').hidden = !copiaAtrasada;
  caja.hidden = false;
  el.querySelector('.btn-eliminar').hidden = true;
  caja.querySelector('[data-accion="eliminar-cancelar"]').focus();
  caja.scrollIntoView({ block: 'nearest' });
}

function cerrarConfirmacion(el) {
  el.querySelector('.confirmar-eliminar').hidden = true;
  const boton = el.querySelector('.btn-eliminar');
  boton.hidden = false;
  boton.focus();
}

function sacarDeLaVista(r) {
  reportes = reportes.filter((x) => x.id !== r.id);
  cantidades[r.estado] = Math.max(0, (cantidades[r.estado] || 0) - 1);
  pintarCantidades();
  cacheIndice.clear();   // el índice de los vecinos cuenta los activos cercanos
  volverALista();
  dibujarPuntos();
}

async function eliminar(el, r) {
  el.classList.add('ocupada');
  try {
    const { riesgos } = await api('/reportes', { method: 'DELETE', body: JSON.stringify({ id: r.id }) });
    actualizarRiesgos(riesgos);
    sacarDeLaVista(r);
    aviso('Reporte eliminado.');
  } catch (err) {
    if (err.status === 404) {
      sacarDeLaVista(r);
      aviso('Ese reporte ya no existía.');
    } else if (!siSeCortoLaSesion(err)) {
      aviso('No se pudo eliminar. ' + err.message, true);
    }
  } finally {
    el.classList.remove('ocupada');
  }
}

async function accion(el, r, boton) {
  switch (boton.dataset.accion) {
    case 'eliminar': abrirConfirmacion(el); return;
    case 'eliminar-cancelar': cerrarConfirmacion(el); return;
    case 'eliminar-confirmado': await eliminar(el, r); return;
    default: break;
  }

  const nota = el.querySelector('.nota textarea').value;
  const tamanoModerado = el.querySelector('.tamano-moderado select').value || null;
  let cambio;
  let mensaje;

  switch (boton.dataset.accion) {
    case 'publicar':
      cambio = { estado: 'verificado', nota_admin: nota, tamano_moderado: tamanoModerado };
      if (r.tiene_foto) cambio.foto_aprobada = el.querySelector('.acciones-pendiente .con-foto input').checked;
      mensaje = 'Publicado. Se verá en el mapa en un par de minutos.';
      break;
    case 'descartar':
      cambio = { estado: 'descartado', nota_admin: nota, tamano_moderado: tamanoModerado };
      mensaje = 'Descartado. No se muestra en el mapa.';
      break;
    case 'guardar':
      cambio = { estado: el.querySelector('.acciones-revisado select').value, nota_admin: nota,
                 tamano_moderado: tamanoModerado };
      if (r.tiene_foto) cambio.foto_aprobada = el.querySelector('.acciones-revisado .con-foto input').checked;
      mensaje = 'Cambios guardados.';
      break;
    case 'quitar-foto':
      // Dos toques, sin ventanas emergentes: la foto se borra de la base
      if (!boton.classList.contains('confirmar')) {
        boton.classList.add('confirmar');
        boton.textContent = 'Se borra para siempre. Tocá de nuevo para confirmar';
        setTimeout(() => { boton.classList.remove('confirmar'); boton.textContent = 'Quitar la foto'; }, 5000);
        return;
      }
      cambio = { quitar_foto: true };
      mensaje = 'Foto quitada.';
      break;
    default:
      return;
  }

  el.classList.add('ocupada');
  try {
    const nuevo = await api('/reportes', { method: 'PATCH', body: JSON.stringify({ id: r.id, ...cambio }) });
    const anterior = r.estado;
    const { riesgos, ...cambios } = nuevo;
    Object.assign(r, cambios);
    actualizarRiesgos(riesgos);
    if (anterior !== r.estado) {
      cantidades[anterior] = Math.max(0, (cantidades[anterior] || 0) - 1);
      cantidades[r.estado] = (cantidades[r.estado] || 0) + 1;
      pintarCantidades();
    }
    // La ficha queda abierta con el estado nuevo; el punto cambia de color en el mapa
    pintarEstado(el, r);
    if (!r.tiene_foto) el.querySelector('.foto').replaceChildren();
    pintarFoto(el, r);
    dibujarPuntos();
    // El índice cuenta los reportes activos cercanos: al moderar puede cambiar
    cacheIndice.clear();
    if (popupIndice && mapa.hasLayer(popupIndice) && seleccionado === r.id) abrirPopup(r);
    aviso(mensaje);
  } catch (err) {
    if (!siSeCortoLaSesion(err)) aviso('No se pudo guardar. ' + err.message, true);
  } finally {
    el.classList.remove('ocupada');
  }
}

// ---------------------------------------------------------------------
// Copia de seguridad
// ---------------------------------------------------------------------
// Todo se arma en este navegador: los datos se piden de a 1000 y las fotos de
// a una (Vercel no deja que una función devuelva más de 4,5 MB). El ZIP queda
// en la carpeta de descargas; de ahí se guarda en la compu o en Drive.
const DIAS_PARA_AVISAR = 7;
const zonaAR = 'America/Argentina/Buenos_Aires';
const fechaHoraAR = (iso) => new Intl.DateTimeFormat('es-AR', {
  timeZone: zonaAR, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso));

function pintarCopia(ultima) {
  const caja = $('copia');
  const estado = $('copia-estado');
  if (!ultima) {
    estado.textContent = 'Todavía no se descargó ninguna copia.';
    caja.classList.add('vencida');
    copiaAtrasada = true;
    pintarResumen();
    return;
  }
  const dias = Math.floor((Date.now() - new Date(ultima)) / 86_400_000);
  estado.textContent = dias === 0 ? `Última: hoy, ${fechaHoraAR(ultima).split(', ')[1]}`
    : dias === 1 ? 'Última: ayer'
    : `Última: hace ${dias} días (${fechaHoraAR(ultima).split(',')[0]})`;
  if (dias >= DIAS_PARA_AVISAR) estado.textContent += '. Conviene hacer una nueva.';
  caja.classList.toggle('vencida', dias >= DIAS_PARA_AVISAR);
  copiaAtrasada = dias >= DIAS_PARA_AVISAR;
  pintarResumen();
}

// Para Excel en español: punto y coma entre columnas y coma decimal
function celda(valor, { texto = false } = {}) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'boolean') return valor ? 'sí' : 'no';
  if (typeof valor === 'number') return String(valor).replace('.', ',');
  let t = String(valor);
  // Un texto del vecino que empieza con = + - @ Excel lo tomaría como fórmula
  if (texto && /^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const fechaCsv = (iso) => iso ? new Intl.DateTimeFormat('sv-SE', {
  timeZone: zonaAR, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso)) : '';

function csv(reportes) {
  const columnas = ['id', 'fecha_reporte', 'latitud', 'longitud', 'estado', 'tipo', 'tamano', 'tamano_corregido', 'lo_queman',
    'cerca_de_agua', 'cerca_de_escuela_o_salud', 'antiguedad', 'descripcion', 'tiene_foto', 'foto_publicada',
    'foto_archivo', 'revisado', 'nota_interna'];
  const filas = reportes.map((r) => [
    r.id, fechaCsv(r.creado_en), r.lat, r.lon, ESTADOS[r.estado], TIPOS[r.tipo] ?? r.tipo, TAMANOS[r.tamano] ?? r.tamano,
    TAMANOS[r.tamano_moderado] ?? r.tamano_moderado,
    r.quema, r.cerca_agua, r.cerca_escuela, ANTIGUEDADES[r.antiguedad] ?? r.antiguedad,
    [r.descripcion, { texto: true }], r.tiene_foto, r.foto_aprobada, r.tiene_foto ? `fotos/${r.id}.jpg` : null,
    fechaCsv(r.revisado_en), [r.nota_admin, { texto: true }],
  ].map((v) => (Array.isArray(v) ? celda(...v) : celda(v))).join(';'));
  // BOM: sin él, Excel abre el UTF-8 con las tildes rotas
  return '﻿' + [columnas.join(';'), ...filas].join('\r\n') + '\r\n';
}

function geojson(reportes) {
  return JSON.stringify({
    type: 'FeatureCollection',
    name: 'reportes_basurales',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
    features: reportes.map(({ lat, lon, ...resto }) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { ...resto, foto_archivo: resto.tiene_foto ? `fotos/${resto.id}.jpg` : null },
    })),
  }, null, 1);
}

function leeme(reportes, fotos, faltantes, ahora) {
  return [
    'COPIA DE SEGURIDAD - Basurales en el Gran Resistencia',
    `Descargada el ${fechaHoraAR(ahora.toISOString())} (hora de Argentina).`,
    `Reportes: ${reportes.length}. Fotos: ${fotos}.`,
    faltantes.length ? `ATENCIÓN: no se pudieron bajar ${faltantes.length} fotos: ${faltantes.join(', ')}` : 'Copia completa.',
    '',
    'ES PRIVADA: tiene fotos sin aprobar, descripciones y ubicaciones exactas,',
    'también de reportes descartados. No la compartas.',
    '',
    'ARCHIVOS',
    '  reportes.geojson  Todos los reportes con todos sus datos, en EPSG:4326.',
    '                    Se abre directo en QGIS. Es la fuente para restaurar:',
    '                    los nombres de campo son los de la tabla public.reportes.',
    '  reportes.csv      Lo mismo para Excel (punto y coma, coma decimal,',
    '                    fechas en hora de Argentina).',
    '  fotos/<id>.jpg    La foto de cada reporte que tiene una, aprobada o no.',
    '',
    'CAMPOS',
    '  id               Identificador del reporte (lo genera el celular del vecino).',
    '  creado_en        Cuándo llegó (UTC en el GeoJSON).',
    '  estado           pendiente, verificado (activo: se ve en el mapa),',
    '                   resuelto (ya no está: no se ve) o descartado.',
    '  tipo, tamano, antiguedad, quema, cerca_agua, cerca_escuela',
    '                   Relevamiento opcional del vecino.',
    '  tamano_moderado  Tamaño corregido por el moderador mirando la foto (vacío',
    '                   si no se corrigió). El índice y el mapa usan este si está.',
    '  descripcion      Texto libre del vecino.',
    '  tiene_foto       Si el reporte tiene foto guardada.',
    '  foto_aprobada    Si la foto se muestra en el mapa público.',
    '  foto_bytes       Tamaño de la foto.',
    '  revisado_en      Última vez que se moderó.',
    '  nota_admin       Nota interna del moderador.',
    '',
    'RESTAURAR',
    '  La estructura de la base está en el repositorio (neon/*.sql). Los datos se',
    '  cargan desde reportes.geojson (por ejemplo, importándolo con QGIS a una tabla',
    '  temporal y copiándolo a public.reportes), y las fotos desde fotos/.',
    '',
  ].join('\r\n');
}

function base64ABytes(base64) {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

async function bajarFoto(id) {
  for (let intento = 0; intento < 2; intento++) {
    try {
      const base64 = await api(`/foto?id=${encodeURIComponent(id)}`);
      return base64 ? base64ABytes(base64) : null;
    } catch (err) {
      if (err.status === 401 || intento === 1) throw err;
    }
  }
  return null;
}

$('btn-copia').addEventListener('click', async () => {
  const boton = $('btn-copia');
  const estado = $('copia-estado');
  boton.disabled = true;
  const textoBoton = boton.textContent;
  boton.textContent = 'Preparando…';
  try {
    const reportes = [];
    for (let pagina = 0; ; pagina++) {
      estado.textContent = `Bajando datos… (${reportes.length} reportes)`;
      const datos = await api(`/exportar?pagina=${pagina}`);
      reportes.push(...datos.reportes);
      if (!datos.hay_mas) break;
    }

    const conFoto = reportes.filter((r) => r.tiene_foto);
    const archivosFotos = [];
    const faltantes = [];
    let hechas = 0;
    const cola = [...conFoto];
    // De a cuatro a la vez: más rápido que de a una, sin saturar la base
    await Promise.all(Array.from({ length: Math.min(4, cola.length) }, async () => {
      while (cola.length) {
        const r = cola.shift();
        try {
          const bytes = await bajarFoto(r.id);
          if (bytes) archivosFotos.push({ nombre: `fotos/${r.id}.jpg`, datos: bytes });
          else faltantes.push(r.id);
        } catch (err) {
          if (err.status === 401) throw err;
          faltantes.push(r.id);
        }
        hechas++;
        estado.textContent = `Bajando fotos… ${hechas} de ${conFoto.length}`;
      }
    }));

    const ahora = new Date();
    archivosFotos.sort((a, b) => a.nombre.localeCompare(b.nombre));
    const zip = armarZip([
      { nombre: 'LEEME.txt', datos: leeme(reportes, archivosFotos.length, faltantes, ahora) },
      { nombre: 'reportes.geojson', datos: geojson(reportes) },
      { nombre: 'reportes.csv', datos: csv(reportes) },
      ...archivosFotos,
    ], ahora);

    const sello = fechaCsv(ahora.toISOString()).replace(' ', '_').replace(':', '');
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(zip);
    enlace.download = `basurales-copia-${sello}.zip`;
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 60_000);

    const anotada = await api('/exportar', {
      method: 'POST', body: JSON.stringify({ reportes: reportes.length, fotos: archivosFotos.length }),
    });
    pintarCopia(anotada.hecha_en);
    const mb = (zip.size / 1_048_576).toFixed(1).replace('.', ',');
    aviso(faltantes.length
      ? `Copia descargada (${mb} MB), pero faltaron ${faltantes.length} fotos. Está anotado en LEEME.txt.`
      : `Copia descargada: ${reportes.length} reportes y ${archivosFotos.length} fotos (${mb} MB).`,
      faltantes.length > 0);
  } catch (err) {
    if (!siSeCortoLaSesion(err)) aviso('No se pudo armar la copia. ' + err.message, true);
    estado.textContent = 'La copia no se completó. Probá de nuevo.';
  } finally {
    boton.disabled = false;
    boton.textContent = textoBoton;
  }
});

// ---------------------------------------------------------------------
// Al abrir: si ya hay sesión, directo a los pendientes
// ---------------------------------------------------------------------
cargarTodo({ alAbrir: true });
