// Panel de moderación. Todo lo que muestra viene de /api/admin, que exige la
// sesión del moderador. Lo que escribió el vecino se muestra siempre como texto
// (textContent), nunca como HTML.

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
// Al abrir: si ya hay sesión, directo a los pendientes
// ---------------------------------------------------------------------
cargar('pendiente', { alAbrir: true });
