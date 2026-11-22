// Conexión a la base. Los archivos que empiezan con "_" no son endpoints:
// Vercel no los publica, solo los usan las funciones.
import { neon } from '@neondatabase/serverless';

// Los únicos roles a los que se baja una función (van al SQL tal cual)
const ROLES = new Set(['anonymous', 'moderador']);

let ejecutorDePrueba = null;

// Corre las consultas en una sola transacción y con el rol pedido.
// La conexión usa el usuario dueño de la base, pero lo primero que hace la
// transacción es bajarse a los permisos de ese rol: lo que la base no le
// permite, tampoco lo permite la función. Todo viaja en un solo pedido HTTP.
async function ejecutarEnNeon(rol, consultas) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw Object.assign(new Error('La página todavía no está conectada a la base.'),
                        { code: 'SIN_CONFIG' });
  }
  const sql = neon(url);
  const resultados = await sql.transaction([
    sql.query(`set local role ${rol}`),
    ...consultas.map(([texto, parametros]) => sql.query(texto, parametros)),
  ]);
  return resultados.slice(1);
}

function ejecutar(rol, consultas) {
  if (!ROLES.has(rol)) throw new Error(`Rol no permitido: ${rol}`);
  return (ejecutorDePrueba || ejecutarEnNeon)(rol, consultas);
}

// consultas: [[texto, parametros], ...]  →  devuelve [filas, filas, ...]
export const comoPublico = (consultas) => ejecutar('anonymous', consultas);
// Solo después de verificar la sesión del moderador (api/_admin.js)
export const comoModerador = (consultas) => ejecutar('moderador', consultas);

// Solo para las pruebas locales: fn(rol, consultas)
export function usarEjecutorDePrueba(fn) { ejecutorDePrueba = fn; }
