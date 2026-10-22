import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readdir, rmdir, unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { encodeBase32, encryptTotp, hashPassword, totpForStep } from '../src/auth/auth.crypto';
import { AppConfig } from '../src/config/app-config';
import { loadEnvironment, WORKSPACE_ROOT } from '../src/config/environment';

type Overview = {
  driver: { id: string; reviewStatus: string; activeVehicleId: string | null; eligible: boolean };
  documents: { id: string; kind: string }[];
  audit?: { actorId: string; action: string; reason: string }[];
};

test(
  'PostgreSQL: onboarding, private files, reviews, eligibility and approval invalidation',
  {
    skip: process.env.RUN_DB_INTEGRATION !== 'true',
    timeout: 60000,
  },
  async () => {
    const env = loadEnvironment();
    assert.equal(env.NODE_ENV, 'test', 'Integration tests require an isolated test environment.');
    assert.ok(env.AUTH_SECRET);
    const id = randomUUID();
    const uploadDir = `.cache/onboarding-test-${id}`;
    const uploadRoot = resolve(WORKSPACE_ROOT, uploadDir);
    const db = new Pool({ connectionString: env.DATABASE_URL });
    const users: string[] = [];
    const phones: string[] = [];
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfig)
      .useValue({ values: { ...env, UPLOAD_DIR: uploadDir } })
      .compile();
    const app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api/v1`;
    const request = (
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
      method?: string,
    ) =>
      fetch(`${base}${path}`, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: { 'Content-Type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    async function register(role: 'driver' | 'client') {
      const phone = `+591${randomInt(70000000, 79999999)}`;
      phones.push(phone);
      const challenge = await request('/auth/otp/request', {
        phone,
        purpose: 'register',
        role,
        displayName: 'Prueba de integración',
      });
      assert.equal(challenge.status, 202);
      const otp = (await challenge.json()) as { challengeId: string; developmentCode: string };
      const response = await request('/auth/otp/verify', {
        challengeId: otp.challengeId,
        code: otp.developmentCode,
      });
      assert.equal(response.status, 200);
      const result = (await response.json()) as { accessToken: string; user: { id: string } };
      users.push(result.user.id);
      return { id: result.user.id, headers: { authorization: `Bearer ${result.accessToken}` } };
    }
    async function staff(role: 'admin' | 'operator') {
      const staffId = randomUUID();
      users.push(staffId);
      const email = `${role}-${id}@example.test`;
      const password = randomBytes(24).toString('base64url');
      const secret = encodeBase32(randomBytes(20));
      await db.query(
        'INSERT INTO app_users(id,email,display_name,password_hash,totp_secret_cipher) VALUES($1,$2,$3,$4,$5)',
        [
          staffId,
          email,
          'Revisor de prueba',
          await hashPassword(password),
          encryptTotp(env.AUTH_SECRET!, secret),
        ],
      );
      await db.query('INSERT INTO app_user_roles(user_id,role) VALUES($1,$2)', [staffId, role]);
      const response = await request('/auth/admin/login', {
        email,
        password,
        totp: totpForStep(secret, Math.floor(Date.now() / 30000)),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { csrfToken: string };
      const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
      return { id: staffId, headers: { cookie, 'x-csrf-token': body.csrfToken } };
    }
    async function upload(
      path: string,
      headers: Record<string, string>,
      kind: string,
      expiresOn?: string,
      content = '%PDF-1.7\nPrueba privada\n%%EOF',
    ) {
      const form = new FormData();
      form.set('kind', kind);
      if (expiresOn) form.set('expiresOn', expiresOn);
      form.set('file', new Blob([content], { type: 'application/pdf' }), 'documento.pdf');
      return fetch(`${base}${path}`, { method: 'POST', headers, body: form });
    }
    try {
      const driver = await register('driver');
      const client = await register('client');
      const admin = await staff('admin');
      const operator = await staff('operator');
      assert.equal((await request('/drivers/me', undefined, client.headers)).status, 403);
      assert.equal((await request('/admin/drivers', undefined, driver.headers)).status, 403);
      assert.equal((await request('/drivers/me/submit', {}, driver.headers)).status, 400);
      const saved = await request(
        '/drivers/me',
        { fullName: 'María Conductora de Prueba' },
        driver.headers,
        'PUT',
      );
      assert.equal(saved.status, 200);
      const vehicleInput = {
        plate: `T${id.replaceAll('-', '').slice(0, 10)}`,
        make: 'Toyota',
        model: 'Corolla',
        year: 2024,
        capacityPassengers: 4,
        serviceTypes: ['passengers', 'parcels'],
      };
      const created = await request('/drivers/me/vehicles', vehicleInput, driver.headers);
      assert.equal(created.status, 201);
      const vehicle = (await created.json()) as { id: string };
      assert.equal(
        (await request('/drivers/me/vehicles', vehicleInput, driver.headers)).status,
        409,
      );
      assert.equal(
        (await request(`/drivers/me/vehicles/${vehicle.id}/activate`, {}, driver.headers)).status,
        403,
      );
      assert.equal(
        (await upload('/drivers/me/documents', driver.headers, 'driver_license', undefined)).status,
        400,
      );
      assert.equal(
        (
          await upload(
            '/drivers/me/documents',
            driver.headers,
            'identity_document',
            undefined,
            'Archivo que finge ser PDF',
          )
        ).status,
        400,
      );
      const identity = await upload('/drivers/me/documents', driver.headers, 'identity_document');
      assert.equal(identity.status, 201);
      const document = (await identity.json()) as { id: string };
      assert.equal((await request(`/documents/${document.id}`)).status, 401);
      assert.equal(
        (await request(`/documents/${document.id}`, undefined, client.headers)).status,
        403,
      );
      assert.equal(
        (await request(`/documents/${document.id}`, undefined, operator.headers)).status,
        403,
      );
      const download = await request(`/documents/${document.id}`, undefined, admin.headers);
      assert.equal(download.status, 200);
      assert.equal(download.headers.get('content-type'), 'application/pdf');
      assert.match(download.headers.get('cache-control')!, /no-store/);
      assert.match(await download.text(), /^%PDF-/);
      assert.equal(
        (await upload('/drivers/me/documents', driver.headers, 'driver_license', '2099-12-31'))
          .status,
        201,
      );
      assert.equal(
        (
          await upload(
            `/drivers/me/vehicles/${vehicle.id}/documents`,
            driver.headers,
            'vehicle_registration',
            '2099-12-31',
          )
        ).status,
        201,
      );
      assert.equal((await request('/drivers/me/submit', {}, driver.headers)).status, 201);
      assert.equal(
        (await request(`/drivers/me/vehicles/${vehicle.id}/submit`, {}, driver.headers)).status,
        201,
      );
      const review = { decision: 'approve', reason: 'Documentación verificada en integración' };
      assert.equal(
        (
          await request(`/admin/drivers/${driver.id}/review`, review, {
            cookie: admin.headers.cookie,
          })
        ).status,
        403,
      );
      assert.equal(
        (await request(`/admin/drivers/${driver.id}/review`, review, operator.headers)).status,
        403,
      );
      const approved = await request(`/admin/drivers/${driver.id}/review`, review, admin.headers);
      assert.equal(approved.status, 201);
      const approvedBody = (await approved.json()) as Overview;
      assert.equal(approvedBody.driver.reviewStatus, 'approved');
      assert.ok(
        approvedBody.audit!.some(
          (event) =>
            event.actorId === admin.id &&
            event.action === 'approve' &&
            event.reason === review.reason,
        ),
      );
      assert.equal(
        (await request(`/admin/vehicles/${vehicle.id}/review`, review, admin.headers)).status,
        201,
      );
      const activated = await request(
        `/drivers/me/vehicles/${vehicle.id}/activate`,
        {},
        driver.headers,
      );
      assert.equal(activated.status, 201);
      assert.equal(((await activated.json()) as Overview).driver.eligible, true);
      await db.query(
        "UPDATE driver_documents SET expires_on=CURRENT_DATE-1 WHERE driver_id=$1 AND kind='driver_license' AND is_current",
        [driver.id],
      );
      const expired = await request('/drivers/me', undefined, driver.headers);
      assert.equal(
        ((await expired.json()) as Overview).driver.eligible,
        false,
        'Expired documents remove eligibility immediately.',
      );
      assert.equal(
        (await request(`/drivers/me/vehicles/${vehicle.id}/activate`, {}, driver.headers)).status,
        400,
      );
      assert.equal(
        (await upload('/drivers/me/documents', driver.headers, 'driver_license', '2099-12-31'))
          .status,
        201,
      );
      const changed = await request('/drivers/me', undefined, driver.headers);
      const changedBody = (await changed.json()) as Overview;
      assert.equal(changedBody.driver.reviewStatus, 'draft');
      assert.equal(changedBody.driver.activeVehicleId, null);
      assert.equal(
        changedBody.documents.filter((item) => item.kind === 'driver_license').length,
        1,
      );
      const history = await db.query(
        "SELECT COUNT(*)::int AS total FROM driver_documents WHERE driver_id=$1 AND kind='driver_license'",
        [driver.id],
      );
      assert.equal(history.rows[0].total, 2, 'Replacing a document preserves the old evidence.');
      assert.equal(
        (await request(`/admin/drivers/${driver.id}/review`, review, admin.headers)).status,
        409,
      );
      const secondDriver = await register('driver');
      assert.equal(
        (
          await request(
            `/drivers/me/vehicles/${vehicle.id}`,
            vehicleInput,
            secondDriver.headers,
            'PUT',
          )
        ).status,
        404,
      );
      assert.equal(
        (await request(`/documents/${document.id}`, undefined, secondDriver.headers)).status,
        403,
      );
      await db.query(
        `INSERT INTO driver_documents(driver_id,kind,original_name,mime_type,byte_size,storage_name,sha256,is_current)
      SELECT $1,'identity_document','histórico.pdf','application/pdf',1,gen_random_uuid()::text,repeat('0',64),FALSE FROM generate_series(1,100)`,
        [driver.id],
      );
      const fileCount = (await readdir(uploadRoot)).length;
      assert.equal(
        (await upload('/drivers/me/documents', driver.headers, 'identity_document')).status,
        400,
        'Repeated replacements cannot exhaust the document store.',
      );
      assert.equal(
        (await readdir(uploadRoot)).length,
        fileCount,
        'Rejected uploads never write another file.',
      );
      assert.equal(
        (
          await request(
            `/admin/users/${driver.id}`,
            { status: 'suspended' },
            admin.headers,
            'PATCH',
          )
        ).status,
        200,
      );
      assert.equal((await request('/drivers/me', undefined, driver.headers)).status, 401);
    } finally {
      await app.close();
      // Only the UUID fixtures of this run are removed; other integration suites share the DB.
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
      await db.end();
      if (uploadRoot.startsWith(`${resolve(WORKSPACE_ROOT, '.cache')}${sep}`)) {
        const files = await readdir(uploadRoot).catch(() => []);
        for (const file of files) await unlink(resolve(uploadRoot, file));
        if (files.length) await rmdir(uploadRoot);
      }
    }
  },
);
