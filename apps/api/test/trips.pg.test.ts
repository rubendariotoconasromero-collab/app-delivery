import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser, UserRole } from '../src/auth';
import { AppConfig } from '../src/config/app-config';
import { loadEnvironment } from '../src/config/environment';
import { TripRepository } from '../src/trips/trip.repository';
import { TripRouting } from '../src/trips/trip.routing';
import { TripService } from '../src/trips/trip.service';

test(
  'PostgreSQL passenger trips: concurrent reservations, PIN attempts, current replay and cash independence',
  { skip: process.env.RUN_DB_INTEGRATION !== 'true', timeout: 60000 },
  async () => {
    const env = loadEnvironment();
    assert.equal(env.NODE_ENV, 'test');
    assert.ok(env.AUTH_SECRET);
    const origin = { latitude: -17.7833, longitude: -63.1821, address: 'Origen ficticio' };
    const destination = { latitude: -17.7751, longitude: -63.1779, address: 'Destino ficticio' };
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          code: 'Ok',
          waypoints: [
            { distance: 10, location: [origin.longitude, origin.latitude] },
            { distance: 10, location: [destination.longitude, destination.latitude] },
          ],
          routes: [
            {
              distance: 1512.5,
              duration: 175.7,
              geometry: {
                type: 'LineString',
                coordinates: [
                  [origin.longitude, origin.latitude],
                  [destination.longitude, destination.latitude],
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
        ...env,
        TRIP_DEVELOPMENT_ENABLED: true,
        TRIP_OSRM_URL: `http://127.0.0.1:${address.port}`,
      },
    } as AppConfig;
    const repository = new TripRepository(config);
    const db = repository.pool;
    const service = new TripService(repository, config, new TripRouting(config));
    const users: string[] = [];
    const throttleKey = `trip-quotes:protocol-test:${randomUUID()}`;
    async function actor(role: UserRole): Promise<AuthenticatedUser> {
      const id = randomUUID();
      users.push(id);
      await db.query('INSERT INTO app_users(id,display_name,email) VALUES($1,$2,$3)', [
        id,
        `Prueba ${role}`,
        `${id}@example.test`,
      ]);
      await db.query('INSERT INTO app_user_roles(user_id,role) VALUES($1,$2)', [id, role]);
      return {
        id,
        displayName: `Prueba ${role}`,
        phone: null,
        email: null,
        roles: [role],
        status: 'active',
        sessionId: randomUUID(),
        sessionKind: role === 'admin' ? 'admin' : 'mobile',
        mfaVerified: role === 'admin',
        sessionExpiresAt: new Date(Date.now() + 3600000),
      };
    }
    async function driver() {
      const user = await actor('driver');
      await db.query(
        "INSERT INTO driver_profiles(user_id,full_name,review_status) VALUES($1,'Conductor de prueba','approved')",
        [user.id],
      );
      const vehicle = (
        await db.query(
          "INSERT INTO driver_vehicles(driver_id,plate,make,model,year,capacity_passengers,service_types,review_status) VALUES($1,$2,'Toyota','Prueba',2024,4,ARRAY['passengers'],'approved') RETURNING id",
          [user.id, `P${randomUUID().replaceAll('-', '').slice(0, 10)}`],
        )
      ).rows[0];
      await db.query('UPDATE driver_profiles SET active_vehicle_id=$2 WHERE user_id=$1', [
        user.id,
        vehicle.id,
      ]);
      for (const kind of ['identity_document', 'driver_license', 'vehicle_registration'])
        await db.query(
          "INSERT INTO driver_documents(driver_id,vehicle_id,kind,original_name,mime_type,byte_size,storage_name,sha256,expires_on) VALUES($1,$2,$3,'prueba.pdf','application/pdf',100,$4,$5,'2099-12-31')",
          [
            user.id,
            kind === 'vehicle_registration' ? vehicle.id : null,
            kind,
            `${randomUUID()}.pdf`,
            'a'.repeat(64),
          ],
        );
      await service.updatePosition(user, {
        latitude: origin.latitude,
        longitude: origin.longitude,
        accuracyMeters: 10,
        capturedAt: new Date().toISOString(),
      });
      await service.availability(user, { online: true });
      return user;
    }
    try {
      const throttles = await Promise.all([
        repository.rateLimit(throttleKey, 1, 60),
        repository.rateLimit(throttleKey, 1, 60),
        repository.rateLimit(throttleKey, 1, 60),
      ]);
      assert.equal(
        throttles.filter(Boolean).length,
        1,
        'The provider slot must be exclusive across concurrent database transactions.',
      );
      const client = await actor('client'),
        admin = await actor('admin'),
        first = await driver(),
        second = await driver();
      const quote = await service.createQuote(client, { origin, destination, passengerCount: 2 });
      const request = { quoteId: quote.id, idempotencyKey: randomUUID() };
      const requests = await Promise.all([
        service.request(client, request),
        service.request(client, request),
      ]);
      assert.equal(requests[0].id, requests[1].id);
      let trip = requests[0];
      await assert.rejects(
        service.request(client, { ...request, quoteId: randomUUID() }),
        ConflictException,
      );
      const assignments = await Promise.allSettled([
        service.assign(admin, trip.id, {
          driverId: first.id,
          reason: 'Asignación concurrente uno',
          idempotencyKey: randomUUID(),
        }),
        service.assign(admin, trip.id, {
          driverId: second.id,
          reason: 'Asignación concurrente dos',
          idempotencyKey: randomUUID(),
        }),
      ]);
      assert.equal(assignments.filter((result) => result.status === 'fulfilled').length, 1);
      const assigned = assignments.find((result) => result.status === 'fulfilled');
      assert.ok(assigned && assigned.status === 'fulfilled');
      const offer = assigned.value.offer!;
      const winner = offer.driverId === first.id ? first : second;
      const loser = winner.id === first.id ? second : first;
      await assert.rejects(
        service.respond(loser, offer.id, { decision: 'accept', idempotencyKey: randomUUID() }),
        ForbiddenException,
      );
      const acceptance = { decision: 'accept', idempotencyKey: randomUUID() };
      trip = await service.respond(winner, offer.id, acceptance);
      assert.equal(trip.state, 'assigned');
      assert.equal('startCode' in trip, false);
      const passengerTrip = await service.get(client, trip.id);
      const originalPin = passengerTrip.startCode!;
      assert.match(originalPin, /^\d{6}$/);
      assert.equal('startCode' in (await service.get(admin, trip.id)), false);
      const staffOwner = {
        ...client,
        sessionKind: 'admin' as const,
        mfaVerified: true,
        roles: ['client', 'admin'] as UserRole[],
      };
      assert.equal('startCode' in (await service.get(staffOwner, trip.id)), false);
      await assert.rejects(
        service.renewCode(staffOwner, trip.id, { idempotencyKey: randomUUID() }),
        ForbiddenException,
      );
      trip = await service.arrive(winner, trip.id, { idempotencyKey: randomUUID() });
      assert.equal(trip.state, 'arrived');
      const wrongPin = originalPin === '000000' ? '111111' : '000000';
      const wrong = { pin: wrongPin, idempotencyKey: randomUUID() };
      await assert.rejects(service.start(winner, trip.id, wrong), ConflictException);
      await assert.rejects(service.start(winner, trip.id, wrong), ConflictException);
      assert.equal(
        (await db.query('SELECT pin_attempts FROM passenger_trips WHERE id=$1', [trip.id])).rows[0]
          .pin_attempts,
        1,
      );
      for (let i = 0; i < 4; i++)
        await assert.rejects(
          service.start(winner, trip.id, { pin: wrongPin, idempotencyKey: randomUUID() }),
          ConflictException,
        );
      await assert.rejects(
        service.start(winner, trip.id, { pin: originalPin, idempotencyKey: randomUUID() }),
        ConflictException,
      );
      const renewed = await service.renewCode(client, trip.id, { idempotencyKey: randomUUID() });
      trip = await service.start(winner, trip.id, {
        pin: renewed.startCode!,
        idempotencyKey: randomUUID(),
      });
      assert.equal(trip.state, 'in_progress');
      await assert.rejects(
        service.finish(winner, trip.id, { idempotencyKey: randomUUID() }),
        ConflictException,
      );
      await service.updatePosition(winner, {
        latitude: destination.latitude,
        longitude: destination.longitude,
        accuracyMeters: 10,
        capturedAt: new Date().toISOString(),
      });
      trip = await service.finish(winner, trip.id, { idempotencyKey: randomUUID() });
      assert.equal(trip.state, 'completed');
      assert.equal(trip.cash.status, 'pending');
      const payment = { receivedCents: trip.totalCents, idempotencyKey: randomUUID() };
      const paid = await Promise.all([
        service.declareCash(winner, trip.id, payment),
        service.declareCash(winner, trip.id, payment),
      ]);
      assert.ok(paid.every((value) => value.cash.status === 'declared_paid'));
      assert.equal(
        (
          await db.query(
            'SELECT COUNT(*)::int AS total FROM passenger_cash_declarations WHERE trip_id=$1',
            [trip.id],
          )
        ).rows[0].total,
        1,
      );
      const replay = await service.respond(winner, offer.id, acceptance);
      assert.equal(replay.state, 'completed');
      assert.equal('startCode' in replay, false);
      assert.equal((await service.active(winner, 'driver')).trip, null);
      assert.equal((await service.history(client, { role: 'client' })).total, 1);
      const quote2 = await service.createQuote(client, { origin, destination, passengerCount: 1 });
      const trip2 = await service.request(client, {
        quoteId: quote2.id,
        idempotencyKey: randomUUID(),
      });
      const proposed = await service.assign(admin, trip2.id, {
        driverId: winner.id,
        reason: 'Comprobar vencimiento persistente',
        idempotencyKey: randomUUID(),
      });
      await db.query(
        "UPDATE passenger_trip_offers SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
        [proposed.offer!.id],
      );
      const expiryRace = await Promise.allSettled([
        service.respond(winner, proposed.offer!.id, {
          decision: 'accept',
          idempotencyKey: randomUUID(),
        }),
        service.cancel(client, trip2.id, {
          reason: 'Cancelar durante vencimiento de oferta',
          idempotencyKey: randomUUID(),
        }),
      ]);
      assert.equal(expiryRace[0].status, 'rejected');
      if (expiryRace[0].status === 'rejected')
        assert.ok(expiryRace[0].reason instanceof ConflictException);
      assert.equal(expiryRace[1].status, 'fulfilled');
      assert.equal(
        (
          await db.query('SELECT state FROM passenger_trip_offers WHERE id=$1', [
            proposed.offer!.id,
          ])
        ).rows[0].state,
        'expired',
      );
      const quote3 = await service.createQuote(client, { origin, destination, passengerCount: 1 });
      const trip3 = await service.request(client, {
        quoteId: quote3.id,
        idempotencyKey: randomUUID(),
      });
      await db.query(
        "UPDATE passenger_trips SET search_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
        [trip3.id],
      );
      await assert.rejects(
        service.cancel(client, trip3.id, {
          reason: 'Cancelación tardía',
          idempotencyKey: randomUUID(),
        }),
        ConflictException,
      );
      assert.equal(
        (await db.query('SELECT state FROM passenger_trips WHERE id=$1', [trip3.id])).rows[0].state,
        'no_driver',
      );
    } finally {
      await db.query('DELETE FROM auth_rate_limits WHERE key=$1 OR key=ANY($2::text[])', [
        throttleKey,
        users.map((id) => `trip-quotes:client:${id}`),
      ]);
      await db.query('DELETE FROM passenger_trip_commands WHERE actor_id=ANY($1::uuid[])', [users]);
      for (const table of [
        'passenger_trip_audit',
        'passenger_cash_declarations',
        'passenger_trip_offers',
      ])
        await db.query(
          `DELETE FROM ${table} WHERE trip_id IN (SELECT id FROM passenger_trips WHERE client_id=ANY($1::uuid[]))`,
          [users],
        );
      await db.query('DELETE FROM passenger_trips WHERE client_id=ANY($1::uuid[])', [users]);
      await db.query('DELETE FROM passenger_quotes WHERE client_id=ANY($1::uuid[])', [users]);
      await db.query('DELETE FROM driver_presence WHERE driver_id=ANY($1::uuid[])', [users]);
      await db.query('DELETE FROM driver_documents WHERE driver_id=ANY($1::uuid[])', [users]);
      await db.query(
        'UPDATE driver_profiles SET active_vehicle_id=NULL WHERE user_id=ANY($1::uuid[])',
        [users],
      );
      await db.query('DELETE FROM driver_vehicles WHERE driver_id=ANY($1::uuid[])', [users]);
      await db.query('DELETE FROM driver_profiles WHERE user_id=ANY($1::uuid[])', [users]);
      await db.query('DELETE FROM app_user_roles WHERE user_id=ANY($1::uuid[])', [users]);
      await db.query('DELETE FROM app_users WHERE id=ANY($1::uuid[])', [users]);
      await repository.onModuleDestroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
