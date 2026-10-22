import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createServer, Socket } from 'node:net';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApplication, createOpenApiDocument } from '../src/application';
import { AppConfig } from '../src/config/app-config';
import { parseEnvironment } from '../src/config/environment';
import { DependencyProbe } from '../src/infrastructure/dependency-probe';

const testConfig = {
  values: parseEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://unused:secret@127.0.0.1:1/unused',
    REDIS_URL: 'redis://127.0.0.1:1',
  }),
};

test('real HTTP API remains alive without infrastructure, reports readiness 503 and publishes OpenAPI', async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AppConfig)
    .useValue(testConfig)
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  try {
    const base = await app.getUrl();
    const live = await fetch(`${base}/api/v1/health/live`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: 'ok', service: 'api' });
    const info = await fetch(`${base}/api/v1/info`, {
      headers: { origin: 'http://localhost:4200' },
    });
    assert.equal(info.headers.get('access-control-allow-origin'), 'http://localhost:4200');
    assert.deepEqual(await info.json(), {
      name: 'AppDelivery',
      environment: 'test',
      market: {
        country: 'BO',
        city: 'Santa Cruz de la Sierra',
        currency: 'BOB',
        currencySymbol: 'Bs',
        timeZone: 'America/La_Paz',
      },
      services: ['passengers', 'parcels'],
    });
    const disallowedOrigin = await fetch(`${base}/api/v1/info`, {
      headers: { origin: 'https://other.example.com' },
    });
    assert.equal(disallowedOrigin.headers.get('access-control-allow-origin'), null);
    const ready = await fetch(`${base}/api/v1/health/ready`);
    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), {
      status: 'degraded',
      dependencies: {
        postgres: { status: 'down' },
        postgis: { status: 'down' },
        redis: { status: 'down' },
      },
    });
    const docs = await fetch(`${base}/api/docs`);
    assert.equal(docs.status, 200);
    assert.match(await docs.text(), /swagger-ui/);
    const schema = createOpenApiDocument(app);
    assert.ok(schema.paths['/api/v1/info']);
    assert.ok(schema.paths['/api/v1/health/ready']?.get?.responses['503']);
    assert.doesNotMatch(JSON.stringify(schema), /secret|postgresql:\/\//);
  } finally {
    await app.close();
  }
});

test('readiness returns HTTP 200 only when all dependency checks succeed', async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AppConfig)
    .useValue(testConfig)
    .overrideProvider(DependencyProbe)
    .useValue({
      check: async () => ({
        status: 'ok',
        dependencies: {
          postgres: { status: 'up' },
          postgis: { status: 'up' },
          redis: { status: 'up' },
        },
      }),
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  try {
    const ready = await fetch(`${await app.getUrl()}/api/v1/health/ready`);
    assert.equal(ready.status, 200);
    assert.equal(((await ready.json()) as { status: string }).status, 'ok');
  } finally {
    await app.close();
  }
});

test('dependency checks time out when a socket accepts connections but never responds', async () => {
  const sockets = new Set<Socket>();
  let acceptedConnections = 0;
  const server = createServer((socket) => {
    acceptedConnections += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const probe = new DependencyProbe({
    values: parseEnvironment({
      DATABASE_URL: `postgresql://unused:secret@127.0.0.1:${address.port}/unused`,
      REDIS_URL: `redis://127.0.0.1:${address.port}`,
    }),
  });
  try {
    const started = Date.now();
    const ready = await probe.check();
    assert.equal(ready.status, 'degraded');
    assert.ok(
      acceptedConnections >= 2,
      'The test must exercise actual PostgreSQL and Redis connections',
    );
    assert.ok(
      Date.now() - started >= 1400,
      'The test must exercise the timeout rather than connection rejection',
    );
    assert.ok(Date.now() - started < 4000, 'Readiness must not hang on a nonresponsive dependency');
  } finally {
    await probe.onModuleDestroy();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
