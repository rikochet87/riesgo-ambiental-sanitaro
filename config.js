// La conexión a la base no se configura acá: la hacen las funciones de /api
// con la variable DATABASE_URL, que se carga en Vercel (Settings >
// Environment Variables) y nunca llega al navegador.

// Área válida (debe coincidir con la regla dentro_gran_resistencia de la base)
export const AREA = { latMin: -27.62, latMax: -27.30, lonMin: -59.15, lonMax: -58.85 };

export const CENTRO_INICIAL = [-27.4606, -58.9839];
export const ZOOM_INICIAL = 13;
