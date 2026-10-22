import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client } = require('pg');
const { createClient } = require('redis');
const { config } = require('dotenv');
config({
  path: process.env.ENV_FILE ?? fileURLToPath(new URL('../.env', import.meta.url)),
  quiet: true,
});

if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
  console.error('Configura DATABASE_URL y REDIS_URL; ejecuta npm run setup para desarrollo.');
  process.exit(1);
}

const database = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 3000,
  query_timeout: 3000,
});
const redis = createClient({
  url: process.env.REDIS_URL,
  socket: { connectTimeout: 3000, reconnectStrategy: false },
});
redis.on('error', () => {});
const key = `appdelivery:loop1:verify:${randomUUID()}`;
let expired = false;
let deadline;

async function verify() {
  await database.connect();
  const result = await database.query(`
    SELECT PostGIS_Version() AS version,
      ST_DWithin(
        ST_SetSRID(ST_MakePoint(-63.1812, -17.7833), 4326)::geography,
        ST_SetSRID(ST_MakePoint(-63.1810, -17.7831), 4326)::geography,
        1000
      ) AS nearby
  `);
  if (result.rows[0]?.nearby !== true)
    throw new Error('La consulta espacial no devolvió el resultado esperado.');
  if (expired) throw new Error('Verification timeout');
  await redis.connect();
  await redis.set(key, 'ok', { EX: 10 });
  if ((await redis.get(key)) !== 'ok')
    throw new Error('Redis no recuperó el valor de verificación.');
  await redis.del(key);
  return result.rows[0].version;
}

try {
  const version = await Promise.race([
    verify(),
    new Promise((_, reject) => {
      deadline = setTimeout(() => {
        expired = true;
        if (redis.isOpen) redis.destroy();
        reject(new Error('Verification timeout'));
      }, 8000);
    }),
  ]);
  console.log(
    JSON.stringify({ postgres: 'ok', postgis: version, spatialQuery: 'ok', redis: 'ok' }, null, 2),
  );
} catch {
  console.error(
    'No se pudo verificar PostgreSQL/PostGIS y Redis. Comprueba que los contenedores estén saludables y ejecuta npm run db:migrate.',
  );
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  if (redis.isOpen) redis.destroy();
  await database.end().catch(() => {});
}
