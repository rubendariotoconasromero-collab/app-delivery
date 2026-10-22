import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { parseEnvironment } from '../src/config/environment';

const required = {
  DATABASE_URL: 'postgresql://test:private-password@127.0.0.1:5432/test',
  REDIS_URL: 'redis://127.0.0.1:6379',
};

test('configuration supplies the confirmed market and parses explicit CORS origins', () => {
  const values = parseEnvironment({
    ...required,
    API_PORT: '3210',
    CORS_ORIGINS: 'http://localhost:4200, https://admin.example.com',
  });
  assert.equal(values.API_PORT, 3210);
  assert.equal(values.MARKET_COUNTRY, 'BO');
  assert.equal(values.MARKET_CITY, 'Santa Cruz de la Sierra');
  assert.equal(values.MARKET_CURRENCY, 'BOB');
  assert.deepEqual(values.CORS_ORIGINS, ['http://localhost:4200', 'https://admin.example.com']);
});

test('test fares require an explicit development switch and cannot run in production', () => {
  assert.equal(parseEnvironment(required).TRIP_DEVELOPMENT_ENABLED, false);
  assert.throws(
    () =>
      parseEnvironment({
        ...required,
        NODE_ENV: 'production',
        AUTH_SECRET: randomBytes(32).toString('base64url'),
        AUTH_OTP_DELIVERY: 'disabled',
        TRIP_DEVELOPMENT_ENABLED: 'true',
      }),
    /TRIP_DEVELOPMENT_ENABLED/,
  );
  assert.throws(
    () => parseEnvironment({ ...required, TRIP_COVERAGE_SOUTH: '-17', TRIP_COVERAGE_NORTH: '-18' }),
    /TRIP_COVERAGE/,
  );
  assert.throws(
    () => parseEnvironment({ ...required, TRIP_PER_KM_CENTS: '-1' }),
    /TRIP_PER_KM_CENTS/,
  );
});

test('invalid configuration is rejected without revealing credential values', () => {
  assert.throws(
    () =>
      parseEnvironment({
        ...required,
        DATABASE_URL: 'https://test:private-password@example.com',
        API_PORT: '0',
        CORS_ORIGINS: '*',
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /DATABASE_URL/);
      assert.match(error.message, /API_PORT/);
      assert.match(error.message, /CORS_ORIGINS/);
      assert.doesNotMatch(error.message, /private-password|https:\/\//);
      return true;
    },
  );
  assert.throws(() => parseEnvironment({ ...required, DATABASE_URL: 'not a URL' }), /DATABASE_URL/);
  assert.throws(
    () => parseEnvironment({ ...required, MARKET_TIME_ZONE: 'invalid-zone' }),
    /MARKET_TIME_ZONE/,
  );
});
