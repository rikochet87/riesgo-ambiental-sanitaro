// Arma un archivo ZIP en el navegador, sin librerías.
// Sin compresión ("stored"): las fotos JPEG ya vienen comprimidas y el resto
// es texto chico. Nombres en UTF-8 (tildes y eñes se ven bien en Windows).
// Límites del formato ZIP clásico: hasta 65.535 archivos y 4 GB en total.

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function fechaDos(d) {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    dia: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// archivos: [{ nombre: 'fotos/x.jpg', datos: Uint8Array | string }]
export function armarZip(archivos, fecha = new Date()) {
  if (archivos.length > 0xFFFF) throw new Error('Demasiados archivos para un ZIP clásico.');
  const codificar = new TextEncoder();
  const { hora, dia } = fechaDos(fecha);
  const cuerpo = [];
  const indice = [];
  let posicion = 0;

  for (const archivo of archivos) {
    const nombre = codificar.encode(archivo.nombre);
    const datos = typeof archivo.datos === 'string' ? codificar.encode(archivo.datos) : archivo.datos;
    const crc = crc32(datos);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // firma
    local.setUint16(4, 20, true);           // versión necesaria
    local.setUint16(6, 0x0800, true);       // nombres en UTF-8
    local.setUint16(8, 0, true);            // sin compresión
    local.setUint16(10, hora, true);
    local.setUint16(12, dia, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, datos.length, true);
    local.setUint32(22, datos.length, true);
    local.setUint16(26, nombre.length, true);
    cuerpo.push(new Uint8Array(local.buffer), nombre, datos);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, hora, true);
    central.setUint16(14, dia, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, datos.length, true);
    central.setUint32(24, datos.length, true);
    central.setUint16(28, nombre.length, true);
    central.setUint32(42, posicion, true);
    indice.push(new Uint8Array(central.buffer), nombre);

    posicion += 30 + nombre.length + datos.length;
  }

  const tamIndice = indice.reduce((s, p) => s + p.length, 0);
  if (posicion + tamIndice > 0xFFFFFFFF) throw new Error('La copia supera los 4 GB del formato ZIP.');
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamIndice, true);
  fin.setUint32(16, posicion, true);

  return new Blob([...cuerpo, ...indice, new Uint8Array(fin.buffer)], { type: 'application/zip' });
}
