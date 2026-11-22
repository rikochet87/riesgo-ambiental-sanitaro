// Conexión a la base. Los archivos que empiezan con "_" no son endpoints:
// Vercel no los publica, solo los usan las funciones.
import { neon } from '@neondatabase/serverless';

let ejecutorDePrueba = null;

// Corre las consultas en una sola transacción y con el rol "anonymous".
// La conexión usa el usuario dueño de la base, pero lo primero que hace la
// transacción es bajarse a los permisos del público: lo que la base no le
// permite al vecino, tampoco lo permite esta función. Todo viaja en un solo
// pedido HTTP a Neon.
async function ejecutarEnNeon(consultas) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw Object.assign(new Error('La página todavía no está conectada a la base.'),
                        { code: 'SIN_CONFIG' });
  }
  const sql = neon(url);
  const resultados = await sql.transaction([
    sql.query('set local role anonymous'),
    ...consultas.map(([texto, parametros]) => sql.query(texto, parametros)),
  ]);
  return resultados.slice(1);
}

// consultas: [[texto, parametros], ...]  →  devuelve [filas, filas, ...]
export const comoPublico = (consultas) => (ejecutorDePrueba || ejecutarEnNeon)(consultas);

// Solo para las pruebas locales (pruebas/api.test.mjs)
export function usarEjecutorDePrueba(fn) { ejecutorDePrueba = fn; }
