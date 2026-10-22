import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { AuthService } from '../src/auth';
import {
  encodeBase32,
  encryptTotp,
  hashPassword,
  tokenHash,
  totpForStep,
} from '../src/auth/auth.crypto';
import { AppConfig } from '../src/config/app-config';
import { loadEnvironment } from '../src/config/environment';

type Json = Record<string, any>;
const origin = {
  latitude: -17.7833,
  longitude: -63.1821,
  address: 'Punto público de prueba en el centro',
  reference: 'Referencia ficticia',
};
const destination = {
  latitude: -17.7751,
  longitude: -63.1779,
  address: 'Segundo punto público de prueba',
};

test(
  'PostgreSQL/HTTP: first passenger journey, exclusive reservations, scoped suspension and cash',
  {
    skip: process.env.RUN_DB_INTEGRATION !== 'true',
    timeout: 120000,
  },
  async () => {
    const env = loadEnvironment();
    assert.equal(env.NODE_ENV, 'test', 'Requires the isolated test database.');
    let routingError = false;
    const osrm = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      assert.match(request.url!, /^\/route\/v1\/driving\//);
      if (routingError) {
        response.statusCode = 503;
        response.end(JSON.stringify({ code: 'NoRoute' }));
        return;
      }
      const coordinates = new URL(request.url!, 'http://127.0.0.1').pathname
        .split('/driving/')[1]!
        .split(';')
        .map((value) => value.split(',').map(Number));
      response.end(
        JSON.stringify({
          code: 'Ok',
          routes: [
            { distance: 1512.5, duration: 175.7, geometry: { type: 'LineString', coordinates } },
          ],
          waypoints: coordinates.map((location) => ({ distance: 0, location })),
        }),
      );
    });
    await new Promise<void>((resolve) => osrm.listen(0, '127.0.0.1', resolve));
    const address = osrm.address();
    assert.ok(address && typeof address !== 'string');
    const db = new Pool({ connectionString: env.DATABASE_URL });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfig)
      .useValue({
        values: {
          ...env,
          TRIP_DEVELOPMENT_ENABLED: true,
          TRIP_OSRM_URL: `http://127.0.0.1:${address.port}`,
        },
      })
      .compile();
    const app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api/v1`;
    const auth = app.get(AuthService);
    const fixture = randomUUID(),
      ip = `journey-${fixture}`;
    const users: string[] = [],
      phones: string[] = [],
      emails: string[] = [];
    async function call(
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
      method?: string,
    ) {
      const response = await fetch(`${base}${path}`, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: { 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = response.status === 204 ? {} : ((await response.json()) as Json);
      return { status: response.status, data };
    }
    async function ok(
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
      method?: string,
    ) {
      const result = await call(path, body, headers, method);
      assert.ok(
        result.status >= 200 && result.status < 300,
        `${path}: HTTP ${result.status}, ${result.data.message ?? ''}`,
      );
      return result.data;
    }
    async function mobile(role: 'client' | 'driver') {
      const phone = `+591${randomInt(70000000, 79999999)}`;
      phones.push(phone);
      const otp = await auth.requestOtp(
        { phone, purpose: 'register', role, displayName: `Prueba ${role}` },
        ip,
      );
      const session = await auth.verifyOtp(otp.challengeId, otp.developmentCode, ip);
      users.push(session.user.id);
      const result = {
        id: session.user.id,
        headers: { authorization: `Bearer ${session.accessToken}` },
        vehicleId: '',
      };
      if (role === 'driver') {
        await db.query(
          "INSERT INTO driver_profiles(user_id,full_name,review_status) VALUES($1,'Conductor ficticio aprobado','approved')",
          [result.id],
        );
        const vehicle = (
          await db.query(
            "INSERT INTO driver_vehicles(driver_id,plate,make,model,year,capacity_passengers,service_types,review_status) VALUES($1,$2,'Toyota','Corolla',2024,4,ARRAY['passengers'],'approved') RETURNING id",
            [result.id, `QA${randomUUID().replaceAll('-', '').slice(0, 10)}`],
          )
        ).rows[0];
        result.vehicleId = vehicle.id;
        await db.query('UPDATE driver_profiles SET active_vehicle_id=$2 WHERE user_id=$1', [
          result.id,
          result.vehicleId,
        ]);
        for (const kind of ['identity_document', 'driver_license', 'vehicle_registration'])
          await db.query(
            "INSERT INTO driver_documents(driver_id,vehicle_id,kind,original_name,mime_type,byte_size,storage_name,sha256,expires_on) VALUES($1,$2,$3,'fixture.pdf','application/pdf',1,$4,repeat('0',64),$5)",
            [
              result.id,
              kind === 'vehicle_registration' ? result.vehicleId : null,
              kind,
              randomUUID(),
              kind === 'identity_document' ? null : '2099-12-31',
            ],
          );
      }
      return result;
    }
    async function staff(role: 'admin' | 'operator' | 'finance') {
      const id = randomUUID(),
        email = `${role}-${fixture}@example.test`,
        secret = encodeBase32(randomBytes(20)),
        password = randomBytes(24).toString('base64url');
      users.push(id);
      emails.push(email);
      await db.query(
        'INSERT INTO app_users(id,email,display_name,password_hash,totp_secret_cipher) VALUES($1,$2,$3,$4,$5)',
        [
          id,
          email,
          'Personal ficticio de prueba',
          await hashPassword(password),
          encryptTotp(env.AUTH_SECRET!, secret),
        ],
      );
      await db.query('INSERT INTO app_user_roles(user_id,role) VALUES($1,$2)', [id, role]);
      const login = await auth.loginAdmin(
        email,
        password,
        totpForStep(secret, Math.floor(Date.now() / 30000)),
        ip,
      );
      return {
        id,
        headers: {
          cookie: `${env.AUTH_ADMIN_COOKIE_NAME}=${login.token}`,
          'x-csrf-token': login.csrfToken,
        },
      };
    }
    let positionSequence = 0;
    async function position(
      driver: Awaited<ReturnType<typeof mobile>>,
      point: { latitude: number; longitude: number } = origin,
    ) {
      return ok(
        '/drivers/me/location',
        {
          latitude: point.latitude,
          longitude: point.longitude,
          accuracyMeters: 8,
          capturedAt: new Date(Date.now() + ++positionSequence).toISOString(),
        },
        driver.headers,
      );
    }
    const key = () => ({ idempotencyKey: randomUUID() });
    try {
      const client = await mobile('client'),
        otherClient = await mobile('client'),
        driver = await mobile('driver'),
        otherDriver = await mobile('driver');
      const admin = await staff('admin'),
        operator = await staff('operator'),
        finance = await staff('finance');
      const config = await ok('/trips/config', undefined, client.headers);
      assert.equal(config.enabled, true);
      assert.equal(config.isTest, true);
      assert.equal(
        (
          await call(
            '/trips/quotes',
            { origin: { ...origin, latitude: 0 }, destination, passengerCount: 2 },
            client.headers,
          )
        ).status,
        400,
      );
      routingError = true;
      assert.equal(
        (await call('/trips/quotes', { origin, destination, passengerCount: 2 }, client.headers))
          .status,
        503,
        'Routing failure cannot produce a fallback quote.',
      );
      routingError = false;
      const quote = (
        await ok('/trips/quotes', { origin, destination, passengerCount: 2 }, client.headers)
      ).quote;
      assert.equal(quote.currency, 'BOB');
      assert.equal(quote.isTest, true);
      assert.equal(quote.totalCents, 876);
      const command = { quoteId: quote.id, ...key() };
      const confirmations = await Promise.all([
        ok('/trips', command, client.headers),
        ok('/trips', command, client.headers),
      ]);
      const trip = confirmations[0]!.trip;
      assert.equal(trip.id, confirmations[1]!.trip.id);
      assert.equal(trip.state, 'searching');
      assert.equal(
        (await call('/trips', { ...command, totalCents: 1 }, client.headers)).status,
        400,
        'Client cannot substitute the accepted price.',
      );
      assert.equal(
        (
          await db.query('SELECT COUNT(*)::int AS n FROM passenger_trips WHERE client_id=$1', [
            client.id,
          ])
        ).rows[0].n,
        1,
      );
      assert.equal((await call(`/trips/${trip.id}`, undefined, otherClient.headers)).status, 403);
      assert.equal((await call('/admin/trips', undefined, driver.headers)).status, 403);
      assert.equal((await call('/admin/trips', undefined, finance.headers)).status, 403);
      await position(driver);
      await position(otherDriver);
      await ok('/drivers/me/availability', { online: true }, driver.headers, 'PUT');
      await ok('/drivers/me/availability', { online: true }, otherDriver.headers, 'PUT');
      const candidates = await ok(
        `/admin/trips/${trip.id}/candidates`,
        undefined,
        operator.headers,
      );
      assert.ok(candidates.items.some((candidate: Json) => candidate.driverId === driver.id));
      const assign = { driverId: driver.id, reason: 'Asignación manual de prueba', ...key() };
      assert.equal(
        (await call(`/admin/trips/${trip.id}/assign`, assign, { cookie: operator.headers.cookie }))
          .status,
        403,
      );
      const offered = (await ok(`/admin/trips/${trip.id}/assign`, assign, operator.headers)).trip;
      assert.equal(offered.state, 'searching');
      assert.equal(offered.offer.state, 'pending');
      assert.equal(
        (await call(`/drivers/me/vehicles/${driver.vehicleId}/activate`, {}, driver.headers))
          .status,
        409,
      );
      const offers = await ok('/drivers/me/trip-offers', undefined, driver.headers);
      assert.equal(offers.items.length, 1);
      assert.equal(offers.items[0].trip.startCode, undefined);
      const accept = { decision: 'accept', ...key() };
      await db.query(
        "UPDATE passenger_quotes SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
        [quote.id],
      );
      assert.ok(
        [403, 404].includes(
          (
            await call(
              `/drivers/me/trip-offers/${offered.offer.id}/respond`,
              accept,
              otherDriver.headers,
            )
          ).status,
        ),
      );
      const assigned = (
        await ok(`/drivers/me/trip-offers/${offered.offer.id}/respond`, accept, driver.headers)
      ).trip;
      assert.equal(assigned.state, 'assigned');
      assert.equal(assigned.startCode, undefined);
      const clientView = (await ok(`/trips/${trip.id}`, undefined, client.headers)).trip;
      assert.match(clientView.startCode, /^\d{6}$/);
      assert.equal(
        (await ok(`/admin/trips/${trip.id}`, undefined, operator.headers)).trip.startCode,
        undefined,
      );
      // A customer who also works as staff must never receive a PIN through a staff cookie.
      const staffEmail = `owner-${fixture}@example.test`,
        staffPassword = randomBytes(24).toString('base64url'),
        staffMfa = encodeBase32(randomBytes(20));
      emails.push(staffEmail);
      await db.query(
        'UPDATE app_users SET email=$2,password_hash=$3,totp_secret_cipher=$4 WHERE id=$1',
        [
          client.id,
          staffEmail,
          await hashPassword(staffPassword),
          encryptTotp(env.AUTH_SECRET!, staffMfa),
        ],
      );
      await db.query("INSERT INTO app_user_roles(user_id,role) VALUES($1,'operator')", [client.id]);
      const staffLogin = await auth.loginAdmin(
        staffEmail,
        staffPassword,
        totpForStep(staffMfa, Math.floor(Date.now() / 30000)),
        ip,
      );
      const ownerCookie = {
        cookie: `${env.AUTH_ADMIN_COOKIE_NAME}=${staffLogin.token}`,
        'x-csrf-token': staffLogin.csrfToken,
      };
      assert.equal(
        (await ok(`/admin/trips/${trip.id}`, undefined, ownerCookie)).trip.startCode,
        undefined,
      );
      assert.equal(
        (await ok(`/trips/${trip.id}`, undefined, ownerCookie)).trip.startCode,
        undefined,
      );
      assert.equal((await call(`/trips/${trip.id}/start-code`, key(), ownerCookie)).status, 403);
      const vehicleInput = {
        plate: 'NOT-CHANGED',
        make: 'Toyota',
        model: 'Corolla',
        year: 2024,
        capacityPassengers: 4,
        serviceTypes: ['passengers'],
      };
      assert.equal(
        (
          await call(
            `/drivers/me/vehicles/${driver.vehicleId}`,
            vehicleInput,
            driver.headers,
            'PUT',
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await call(
            `/trips/${trip.id}/start`,
            { pin: clientView.startCode, ...key() },
            driver.headers,
          )
        ).status,
        409,
        'Start requires arrival.',
      );
      await position(driver);
      assert.equal(
        (await ok(`/trips/${trip.id}/arrive`, key(), driver.headers)).trip.state,
        'arrived',
      );
      const wrong = clientView.startCode === '999999' ? '888888' : '999999';
      for (let attempt = 0; attempt < 5; attempt++)
        assert.equal(
          (await call(`/trips/${trip.id}/start`, { pin: wrong, ...key() }, driver.headers)).status,
          409,
        );
      assert.equal(
        (await db.query('SELECT pin_attempts FROM passenger_trips WHERE id=$1', [trip.id])).rows[0]
          .pin_attempts,
        5,
      );
      const renewed = (await ok(`/trips/${trip.id}/start-code`, key(), client.headers)).trip;
      assert.match(renewed.startCode, /^\d{6}$/);
      await ok(`/admin/users/${driver.id}`, { status: 'suspended' }, admin.headers, 'PATCH');
      const limited = await ok('/auth/me', undefined, driver.headers);
      assert.equal(limited.user.status, 'suspended');
      assert.equal(limited.restricted, true);
      assert.equal(
        (await call('/drivers/me/availability', { online: true }, driver.headers, 'PUT')).status,
        403,
        'Limited credentials cannot accept new work.',
      );
      assert.equal(
        (await ok(`/trips/${trip.id}/start`, { pin: renewed.startCode, ...key() }, driver.headers))
          .trip.state,
        'in_progress',
      );
      assert.equal(
        (
          await call(
            `/trips/${trip.id}/cancel`,
            { reason: 'No permitido después de iniciar', ...key() },
            client.headers,
          )
        ).status,
        409,
      );
      assert.equal(
        (await call(`/trips/${trip.id}/finish`, key(), driver.headers)).status,
        409,
        'Finish requires destination proximity.',
      );
      await position(driver, destination);
      const finishKey = key();
      assert.equal(
        (await ok(`/trips/${trip.id}/finish`, finishKey, driver.headers)).trip.state,
        'completed',
      );
      assert.equal(
        (await ok(`/trips/${trip.id}/finish`, finishKey, driver.headers)).trip.cash.status,
        'pending',
      );
      assert.equal((await ok('/trips/active?role=client', undefined, client.headers)).trip, null);
      const cashKey = { receivedCents: trip.totalCents, ...key() };
      assert.equal((await call(`/trips/${trip.id}/cash`, cashKey, client.headers)).status, 403);
      const cash = (await ok(`/trips/${trip.id}/cash`, cashKey, driver.headers)).trip.cash;
      assert.equal(cash.status, 'declared_paid');
      assert.equal(cash.receivedCents, trip.totalCents);
      assert.equal(
        (
          await db.query(
            'SELECT COUNT(*)::int AS n FROM passenger_cash_declarations WHERE trip_id=$1',
            [trip.id],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (await call('/auth/me', undefined, driver.headers)).status,
        401,
        'Scoped continuation ends when the outstanding work ends.',
      );
      await ok(`/admin/users/${driver.id}`, { status: 'active' }, admin.headers, 'PATCH');
      assert.equal(
        (await call('/drivers/me/availability', undefined, driver.headers)).status,
        401,
        'Reactivation cannot expand an old restricted credential.',
      );

      // Two operators cannot hold the same driver for different clients at once.
      const quoteA = (
        await ok('/trips/quotes', { origin, destination, passengerCount: 1 }, client.headers)
      ).quote;
      const quoteB = (
        await ok('/trips/quotes', { origin, destination, passengerCount: 1 }, otherClient.headers)
      ).quote;
      const tripA = (await ok('/trips', { quoteId: quoteA.id, ...key() }, client.headers)).trip;
      const tripB = (await ok('/trips', { quoteId: quoteB.id, ...key() }, otherClient.headers))
        .trip;
      await position(otherDriver);
      const race = await Promise.all(
        [tripA, tripB].map((value) =>
          call(
            `/admin/trips/${value.id}/assign`,
            { driverId: otherDriver.id, reason: 'Prueba de reserva exclusiva', ...key() },
            operator.headers,
          ),
        ),
      );
      assert.equal(race.filter((value) => value.status >= 200 && value.status < 300).length, 1);
      assert.equal(race.filter((value) => value.status === 409).length, 1);
      const winner = race.find((value) => value.status >= 200 && value.status < 300)!.data.trip;
      const pendingOffer = (await ok('/drivers/me/trip-offers', undefined, otherDriver.headers))
        .items[0];
      assert.equal(pendingOffer.trip.id, winner.id);
      const owner = winner.clientId === client.id ? client : otherClient;
      const cancel = { reason: 'Cancelación concurrente antes de iniciar', ...key() };
      const cancelRace = await Promise.all([
        call(`/trips/${winner.id}/cancel`, cancel, owner.headers),
        call(
          `/drivers/me/trip-offers/${pendingOffer.id}/respond`,
          { decision: 'accept', ...key() },
          otherDriver.headers,
        ),
      ]);
      assert.ok(cancelRace.some((value) => value.status >= 200 && value.status < 300));
      const final = (await ok(`/trips/${winner.id}`, undefined, owner.headers)).trip;
      assert.equal(final.state, 'cancelled');
      assert.equal(
        (
          await db.query(
            "SELECT COUNT(*)::int AS n FROM passenger_trips WHERE driver_id=$1 AND state IN ('assigned','arrived','in_progress')",
            [otherDriver.id],
          )
        ).rows[0].n,
        0,
      );
      for (const [value, account] of [
        [tripA, client],
        [tripB, otherClient],
      ] as const)
        if (value.id !== winner.id)
          await ok(
            `/trips/${value.id}/cancel`,
            { reason: 'Fin de prueba', ...key() },
            account.headers,
          );
      await ok('/auth/logout', {}, otherDriver.headers);
      assert.equal(
        (
          await db.query('SELECT available FROM driver_presence WHERE driver_id=$1', [
            otherDriver.id,
          ])
        ).rows[0].available,
        false,
        'Logging out cannot leave a driver available for dispatch.',
      );
    } finally {
      await app.close();
      await new Promise<void>((resolve, reject) =>
        osrm.close((error) => (error ? reject(error) : resolve())),
      );
      const trips = (
        await db.query(
          'SELECT id FROM passenger_trips WHERE client_id=ANY($1::uuid[]) OR driver_id=ANY($1::uuid[])',
          [users],
        )
      ).rows.map((row) => row.id);
      await db.query('DELETE FROM passenger_trip_commands WHERE actor_id=ANY($1::uuid[])', [users]);
      await db.query('DELETE FROM passenger_cash_declarations WHERE trip_id=ANY($1::uuid[])', [
        trips,
      ]);
      await db.query('DELETE FROM passenger_trip_audit WHERE trip_id=ANY($1::uuid[])', [trips]);
      await db.query('DELETE FROM passenger_trip_offers WHERE trip_id=ANY($1::uuid[])', [trips]);
      await db.query('DELETE FROM passenger_trips WHERE id=ANY($1::uuid[])', [trips]);
      await db.query('DELETE FROM passenger_quotes WHERE client_id=ANY($1::uuid[])', [users]);
      await db.query('DELETE FROM driver_presence WHERE driver_id=ANY($1::uuid[])', [users]);
      await db.query(
        'UPDATE driver_profiles SET active_vehicle_id=NULL WHERE user_id=ANY($1::uuid[])',
        [users],
      );
      await db.query(
        'DELETE FROM onboarding_audit WHERE driver_id=ANY($1::uuid[]) OR actor_id=ANY($1::uuid[])',
        [users],
      );
      await db.query('DELETE FROM driver_documents WHERE driver_id=ANY($1::uuid[])', [users]);
      await db.query('DELETE FROM driver_vehicles WHERE driver_id=ANY($1::uuid[])', [users]);
      await db.query('DELETE FROM driver_profiles WHERE user_id=ANY($1::uuid[])', [users]);
      await db.query(
        'DELETE FROM auth_audit WHERE actor_id=ANY($1::uuid[]) OR target_id=ANY($1::uuid[])',
        [users],
      );
      await db.query('DELETE FROM auth_sessions WHERE user_id=ANY($1::uuid[])', [users]);
      await db.query('DELETE FROM app_user_roles WHERE user_id=ANY($1::uuid[])', [users]);
      await db.query('DELETE FROM app_users WHERE id=ANY($1::uuid[])', [users]);
      await db.query('DELETE FROM auth_otp_challenges WHERE phone=ANY($1::text[])', [phones]);
      await db.query('DELETE FROM auth_rate_limits WHERE key=ANY($1::text[])', [
        [
          ...users.map((id) => `trip-quotes:client:${id}`),
          ...phones.map((phone) => `otp-phone:${phone}`),
          ...emails.map((email) => `staff-email:${tokenHash(email)}`),
          `otp-request-ip:${tokenHash(ip)}`,
          `otp-verify-ip:${tokenHash(ip)}`,
          `staff-ip:${tokenHash(ip)}`,
        ],
      ]);
      await db.end();
    }
  },
);
