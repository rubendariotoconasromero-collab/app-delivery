import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { AppConfig } from '../src/config/app-config';
import { TripRouting } from '../src/trips/trip.routing';

const origin = { latitude: -17.7833, longitude: -63.1821, address: 'Plaza principal' };
const destination = { latitude: -17.7751, longitude: -63.1779, address: 'Destino de prueba' };
test(
  'OSRM protocol: preserves street geometry and rejects snaps, malformed routes and redirects',
  { timeout: 20000 },
  async () => {
    let mode = 'ok';
    let requests = 0;
    const server = createServer((request, response) => {
      requests++;
      assert.match(request.url!, /^\/route\/v1\/driving\/-63.1821,-17.7833;-63.1779,-17.7751\?/);
      assert.match(request.headers['user-agent']!, /AppDelivery/);
      if (mode === 'redirect') {
        response.writeHead(302, { location: '/elsewhere' });
        response.end();
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          code: 'Ok',
          waypoints: [
            { distance: mode === 'far' ? 201 : 10, location: [-63.1821, -17.7833] },
            { distance: 10, location: [-63.1779, -17.7751] },
          ],
          routes: [
            {
              distance: 1512.5,
              duration: 175.7,
              geometry: {
                type: 'LineString',
                coordinates:
                  mode === 'invalid'
                    ? [
                        [500, -17],
                        [-63, -18],
                      ]
                    : [
                        [-63.1821, -17.7833],
                        [-63.18, -17.78],
                        [-63.1779, -17.7751],
                      ],
              },
            },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const config = {
      values: {
        NODE_ENV: 'test',
        TRIP_DEVELOPMENT_ENABLED: true,
        TRIP_OSRM_URL: `http://127.0.0.1:${address.port}`,
      },
    } as AppConfig;
    try {
      const routing = new TripRouting(config);
      const route = await routing.calculate(origin, destination);
      assert.equal(route.provider, 'osrm');
      assert.equal(route.distanceMeters, 1513);
      assert.equal(route.durationSeconds, 176);
      assert.equal(route.geometry.coordinates.length, 3);
      for (mode of ['far', 'invalid', 'redirect'])
        await assert.rejects(routing.calculate(origin, destination), ServiceUnavailableException);
      mode = 'ok';
      const blocked = new TripRouting({
        values: { ...config.values, NODE_ENV: 'production' },
      } as AppConfig);
      await assert.rejects(blocked.calculate(origin, destination), ServiceUnavailableException);
      assert.equal(requests, 4, 'Production must not make a routing request.');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
