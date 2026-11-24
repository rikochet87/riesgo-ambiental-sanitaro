const instalar = document.getElementById('btn-instalar');
const modoApp = window.matchMedia('(display-mode: standalone)');
const appleMovil = /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const safariMac = !appleMovil && /Macintosh.*Version\/.*Safari\//.test(navigator.userAgent);
let solicitud;
let instalada = false;

function actualizarBoton() {
  instalar.hidden = instalada || modoApp.matches || navigator.standalone
    || !(solicitud || appleMovil || safariMac);
}

window.addEventListener('beforeinstallprompt', (evento) => {
  evento.preventDefault();
  solicitud = evento;
  actualizarBoton();
});
window.addEventListener('appinstalled', () => {
  instalada = true;
  solicitud = undefined;
  actualizarBoton();
});
modoApp.addEventListener('change', actualizarBoton);
actualizarBoton();

instalar.addEventListener('click', async () => {
  if (solicitud) {
    const evento = solicitud;
    solicitud = undefined;
    instalar.disabled = true;
    try {
      const resultado = await evento.prompt();
      instalada = resultado?.outcome === 'accepted';
    } catch {
      document.getElementById('pasos-instalar').textContent =
        'Abrí el menú del navegador y elegí Instalar Basurales, si aparece.';
      document.getElementById('dlg-instalar').showModal();
    } finally {
      instalar.disabled = false;
      actualizarBoton();
    }
    return;
  }

  document.getElementById('pasos-instalar').textContent = appleMovil
    ? 'En Safari, tocá Compartir → Agregar a pantalla de inicio. Si aparece «Abrir como app web», dejalo activado y tocá Agregar.'
    : 'En Safari, elegí Archivo → Agregar al Dock y confirmá.';
  document.getElementById('dlg-instalar').showModal();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((error) => {
    console.warn('No se pudo preparar Basurales para abrir sin conexión.', error);
  });
}
