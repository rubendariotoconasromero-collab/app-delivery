import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  assertFresh,
  assertNear,
  calculateFare,
  cashStatus,
  distanceMeters,
  parse,
  pinInput,
  quoteInput,
} from '../src/trips/trip.rules';

const origin = { latitude: -17.7833, longitude: -63.1821, address: 'Plaza principal' };
const destination = { latitude: -17.7751, longitude: -63.1779, address: 'Destino de prueba' };
test('Passenger quotes: server cents, minimum and explicit test tariff', () => {
  const fare = calculateFare(1513, 176);
  assert.equal(fare.totalCents, 500 + 303 + 73);
  assert.deepEqual(fare.breakdown, {
    baseCents: 500,
    distanceCents: 303,
    timeCents: 73,
    minimumCents: 800,
  });
  assert.equal(calculateFare(200, 20).totalCents, 800);
  assert.equal(fare.isTest, true);
  assert.throws(
    () => parse(quoteInput, { origin, destination, passengerCount: 1, totalCents: 1 }),
    BadRequestException,
  );
  assert.throws(
    () => parse(quoteInput, { origin, destination, passengerCount: 9 }),
    BadRequestException,
  );
});
test('Passenger GPS milestones reject stale, future, inaccurate and distant positions', () => {
  const now = Date.now();
  const position = { ...origin, accuracyMeters: 20, capturedAt: new Date(now).toISOString() };
  assert.doesNotThrow(() => assertFresh(position, now));
  assert.throws(
    () => assertFresh({ ...position, capturedAt: new Date(now - 61000).toISOString() }, now),
    ConflictException,
  );
  assert.throws(
    () => assertFresh({ ...position, capturedAt: new Date(now + 11000).toISOString() }, now),
    ConflictException,
  );
  assert.throws(() => assertFresh({ ...position, accuracyMeters: 101 }, now), ConflictException);
  assert.doesNotThrow(() => assertNear(position, origin));
  assert.throws(() => assertNear(position, destination), ConflictException);
  assert.ok(distanceMeters(origin, destination) > 900);
});
test('Passenger cash declaration stays independent and derives paid, partial or unpaid', () => {
  assert.equal(cashStatus(1000, 1000), 'declared_paid');
  assert.equal(cashStatus(1000, 1), 'partial');
  assert.equal(cashStatus(1000, 0), 'unpaid');
  assert.throws(() => cashStatus(1000, 1001), BadRequestException);
  assert.throws(
    () => parse(pinInput, { idempotencyKey: 'a2172968-c274-458c-9350-8aa737fc91b7', pin: '1234' }),
    BadRequestException,
  );
});
