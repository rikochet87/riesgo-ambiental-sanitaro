// Dirección de la Data API de tu proyecto de Neon.
// Se copia de: Neon Console > Postgres database > Data API (la URL REST,
// la que incluye ".apirest" y termina en "/rest/v1").
// No lleva ninguna clave: el acceso lo limitan los permisos de la base,
// donde el rol anonymous solo puede insertar reportes y leer la vista pública.
export const NEON_DATA_API =
  'https://ep-billowing-sound-b64ctwer.apirest.c-2.sa-east-1.aws.neon.tech/neondb/rest/v1';

// Área válida (debe coincidir con la regla dentro_gran_resistencia de la base)
export const AREA = { latMin: -27.62, latMax: -27.30, lonMin: -59.15, lonMax: -58.85 };

export const CENTRO_INICIAL = [-27.4606, -58.9839];
export const ZOOM_INICIAL = 13;
