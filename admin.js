// Panel de moderación. Todo lo que muestra viene de /api/admin, que exige la
// sesión del moderador. Lo que escribió el vecino se muestra siempre como texto
// (textContent), nunca como HTML.
import { armarZip } from './admin-zip.js';

const ESTADOS = {
  pendiente: 'Pendiente', verificado: 'Activo', en_gestion: 'En gestión',
  resuelto: 'Resuelto', descartado: 'Descartado',
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
let filtro = 'pendiente';
let cantidades = {};
let pedidoActual = 0;   // para descartar respuestas que llegan tarde

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
    await cargar(filtro);
  } catch (err) {
    mostrarEntrada(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
});

$('btn-salir').addEventListener('click', async () => {
  try { await api('/entrar', { method: 'DELETE' }); } catch { /* igual se sale */ }
  $('lista').replaceChildren();
  mostrarEntrada();
});

// ---------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------
document.querySelectorAll('.filtros button').forEach((b) =>
  b.addEventListener('click', () => cargar(b.dataset.estado)));

function pintarCantidades() {
  for (const el of document.querySelectorAll('[data-n]')) el.textContent = cantidades[el.dataset.n] ?? 0;
}

function mostrarVacio() {
  const hay = $('lista').children.length > 0;
  $('vacio').hidden = hay;
  $('vacio').textContent = hay ? ''
    : filtro === 'pendiente' ? 'No hay reportes pendientes de revisión.'
    : `No hay reportes en «${ESTADOS[filtro]}».`;
}

async function cargar(estado, { alAbrir = false } = {}) {
  filtro = estado;
  const este = ++pedidoActual;
  document.querySelectorAll('.filtros button').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.estado === estado)));
  // Nunca dejar a la vista tarjetas de otra pestaña mientras carga esta:
  // se podría publicar o descartar una creyendo que es de esta lista.
  $('lista').replaceChildren();
  $('vacio').textContent = 'Cargando…';
  $('vacio').hidden = false;

  let datos;
  try {
    datos = await api(`/reportes?estado=${encodeURIComponent(estado)}`);
  } catch (err) {
    if (este !== pedidoActual) return;
    // Al abrir la página sin sesión no "venció" nada: solo pedir la clave
    if (alAbrir && err.status === 401) { mostrarEntrada(); return; }
    if (!siSeCortoLaSesion(err)) aviso('No se pudo cargar la lista. ' + err.message, true);
    return;
  }
  // Si mientras tanto se eligió otra pestaña, esta respuesta ya no corresponde
  if (este !== pedidoActual) return;
  mostrarPanel();
  cantidades = datos.cantidades;
  pintarCantidades();
  pintarCopia(datos.ultima_copia);
  $('lista').replaceChildren(...datos.reportes.map(tarjeta));
  mostrarVacio();
}

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
    r.tipo && TIPOS[r.tipo], r.tamano && TAMANOS[r.tamano],
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
  el.querySelector('.nota textarea').value = r.nota_admin || '';
  el.querySelector('.nota').open = Boolean(r.nota_admin);

  pintarFoto(el, r);
  el.addEventListener('click', (e) => {
    const boton = e.target.closest('[data-accion]');
    if (boton) accion(el, r, boton);
  });
  return el;
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
async function accion(el, r, boton) {
  const nota = el.querySelector('.nota textarea').value;
  let cambio;
  let mensaje;

  switch (boton.dataset.accion) {
    case 'publicar':
      cambio = { estado: 'verificado', nota_admin: nota };
      if (r.tiene_foto) cambio.foto_aprobada = el.querySelector('.acciones-pendiente .con-foto input').checked;
      mensaje = 'Publicado. Se verá en el mapa en un par de minutos.';
      break;
    case 'descartar':
      cambio = { estado: 'descartado', nota_admin: nota };
      mensaje = 'Descartado. No se muestra en el mapa.';
      break;
    case 'guardar':
      cambio = { estado: el.querySelector('.acciones-revisado select').value, nota_admin: nota };
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
    Object.assign(r, nuevo);
    if (anterior !== r.estado) {
      cantidades[anterior] = Math.max(0, (cantidades[anterior] || 0) - 1);
      cantidades[r.estado] = (cantidades[r.estado] || 0) + 1;
      pintarCantidades();
    }
    if (r.estado !== filtro) {
      el.remove();
      mostrarVacio();
    } else {
      pintarEstado(el, r);
      if (!r.tiene_foto) el.querySelector('.foto').replaceChildren();
      pintarFoto(el, r);
    }
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
    return;
  }
  const dias = Math.floor((Date.now() - new Date(ultima)) / 86_400_000);
  estado.textContent = dias === 0 ? `Última: hoy, ${fechaHoraAR(ultima).split(', ')[1]}`
    : dias === 1 ? 'Última: ayer'
    : `Última: hace ${dias} días (${fechaHoraAR(ultima).split(',')[0]})`;
  if (dias >= DIAS_PARA_AVISAR) estado.textContent += '. Conviene hacer una nueva.';
  caja.classList.toggle('vencida', dias >= DIAS_PARA_AVISAR);
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
  const columnas = ['id', 'fecha_reporte', 'latitud', 'longitud', 'estado', 'tipo', 'tamano', 'lo_queman',
    'cerca_de_agua', 'cerca_de_escuela_o_salud', 'antiguedad', 'descripcion', 'tiene_foto', 'foto_publicada',
    'foto_archivo', 'revisado', 'nota_interna'];
  const filas = reportes.map((r) => [
    r.id, fechaCsv(r.creado_en), r.lat, r.lon, ESTADOS[r.estado], TIPOS[r.tipo] ?? r.tipo, TAMANOS[r.tamano] ?? r.tamano,
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
    '  estado           pendiente, verificado (activo, rojo), en_gestion (amarillo),',
    '                   resuelto (verde) o descartado.',
    '  tipo, tamano, antiguedad, quema, cerca_agua, cerca_escuela',
    '                   Relevamiento opcional del vecino.',
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
cargar('pendiente', { alAbrir: true });
