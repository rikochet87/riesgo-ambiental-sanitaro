// Conexión a un Postgres local, para las pruebas y el servidor local.
// Usa PGHOST / PGDATABASE / PGUSER si están definidas.
import pg from 'pg';
import { userInfo } from 'node:os';

export const conexion = {
  host: process.env.PGHOST || '/var/run/postgresql',
  database: process.env.PGDATABASE || 'prueba_api',
  user: process.env.PGUSER || userInfo().username,
};

// Igual que en Vercel: una transacción, primero bajarse al rol anonymous
export async function ejecutorLocal(consultas) {
  const c = new pg.Client(conexion);
  await c.connect();
  try {
    await c.query('begin');
    await c.query('set local role anonymous');
    const salida = [];
    for (const [texto, parametros] of consultas) salida.push((await c.query(texto, parametros)).rows);
    await c.query('commit');
    return salida;
  } catch (err) {
    await c.query('rollback').catch(() => {});
    throw err;
  } finally {
    await c.end();
  }
}

// Como el dueño de la base (para moderar y revisar lo guardado)
export async function admin(texto, parametros = []) {
  const c = new pg.Client(conexion);
  await c.connect();
  try { return (await c.query(texto, parametros)).rows; } finally { await c.end(); }
}
