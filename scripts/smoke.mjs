import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { parse } = require('dotenv');
const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = resolve(root, process.env.ENV_FILE ?? '.env');
let fileValues = {};
try {
  fileValues = parse(readFileSync(envPath));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  if (process.env.ENV_FILE) {
    console.error('No existe el archivo seleccionado mediante ENV_FILE.');
    process.exit(1);
  }
}
const environment = { ...fileValues, ...process.env };
const baseUrl =
  environment.SMOKE_BASE_URL ?? `http://127.0.0.1:${environment.API_PORT ?? 3000}/api/v1`;
const requireReady = process.argv.includes('--require-ready');

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(10000) });
  return { response, body: await response.json() };
}

try {
  const live = await get('/health/live');
  if (!live.response.ok || live.body.status !== 'ok')
    throw new Error('La API no responde a liveness.');
  const info = await get('/info');
  if (
    !info.response.ok ||
    info.body.market?.country !== 'BO' ||
    info.body.market?.currency !== 'BOB'
  ) {
    throw new Error('El contrato de información no contiene el mercado BO/BOB.');
  }
  const ready = await get('/health/ready');
  if (![200, 503].includes(ready.response.status))
    throw new Error('Readiness devuelve un código inesperado.');
  const dependencies = ['postgres', 'postgis', 'redis'];
  for (const dependency of dependencies) {
    if (!['up', 'down'].includes(ready.body.dependencies?.[dependency]?.status)) {
      throw new Error(`Falta estado de ${dependency} en readiness.`);
    }
  }
  if (
    requireReady &&
    (!ready.response.ok ||
      ready.body.status !== 'ok' ||
      dependencies.some((name) => ready.body.dependencies[name].status !== 'up'))
  ) {
    throw new Error('PostgreSQL, PostGIS y Redis deben estar disponibles.');
  }
  console.log(
    JSON.stringify(
      {
        api: 'ok',
        city: info.body.market.city,
        currency: info.body.market.currency,
        readiness: ready.body,
      },
      null,
      2,
    ),
  );
  if (!ready.response.ok)
    console.log(
      'API disponible; infraestructura pendiente. Usa --require-ready para exigir todas las dependencias.',
    );
} catch (error) {
  console.error(`Comprobación fallida: ${error.message}`);
  process.exitCode = 1;
}
