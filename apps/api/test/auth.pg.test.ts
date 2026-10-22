import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { parse } from 'dotenv';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth';
import {
  encodeBase32,
  encryptTotp,
  hashPassword,
  tokenHash,
  totpForStep,
} from '../src/auth/auth.crypto';
import { PublicUser } from '../src/auth/auth.types';
import { configureApplication } from '../src/application';
import { AppConfig } from '../src/config/app-config';
import { parseEnvironment, WORKSPACE_ROOT } from '../src/config/environment';

const enabled = process.env.RUN_DB_INTEGRATION === 'true';

test(
  'PostgreSQL identity: OTP races, persistent limits, MFA, CSRF, role changes and suspension',
  { skip: !enabled, timeout: 120000 },
  async () => {
    const file = parse(readFileSync(resolve(WORKSPACE_ROOT, process.env.ENV_FILE ?? '.env.test')));
    const secret = randomBytes(32).toString('base64url');
    const config = parseEnvironment({
      ...file,
      DATABASE_URL: process.env.DATABASE_URL ?? file.DATABASE_URL,
      NODE_ENV: 'test',
      AUTH_SECRET: secret,
      AUTH_OTP_DELIVERY: 'development',
    });
    const pool = new Pool({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 2500 });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfig)
      .useValue({ values: config })
      .compile();
    const app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const auth = app.get(AuthService);
    const base = `${await app.getUrl()}/api/v1`;
    const ip = `auth-integration-${randomUUID()}`;
    const email = `integration-${randomUUID()}@example.test`;
    const phones = Array.from(
      { length: 4 },
      () => `+5917${String(randomInt(0, 10_000_000)).padStart(7, '0')}`,
    );
    const userIds: string[] = [];
    const challengeIds: string[] = [];
    const queryHttp = (
      path: string,
      headers: Record<string, string>,
      body?: unknown,
      method?: string,
    ) =>
      fetch(`${base}${path}`, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: { 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const otp = async (
      phone: string,
      role: 'client' | 'driver',
      purpose: 'register' | 'login' | 'recover' = 'register',
    ) => {
      // Advance only this fixture's resend timestamp, leaving every other test's data intact.
      await pool.query(
        `UPDATE auth_otp_challenges SET created_at=NOW()-INTERVAL '61 seconds' WHERE phone=$1`,
        [phone],
      );
      const result = await auth.requestOtp(
        {
          phone,
          role,
          purpose,
          ...(purpose === 'register' ? { displayName: 'Prueba integración' } : {}),
        },
        ip,
      );
      challengeIds.push(result.challengeId);
      return result;
    };
    const expect401 = (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 401;
    try {
      const challenge = await otp(phones[0]!, 'client');
      const race = await Promise.allSettled([
        auth.verifyOtp(challenge.challengeId, challenge.developmentCode, ip),
        auth.verifyOtp(challenge.challengeId, challenge.developmentCode, ip),
      ]);
      assert.equal(
        race.filter((result) => result.status === 'fulfilled').length,
        1,
        'Concurrent verification consumes OTP exactly once',
      );
      const first = race.find((result) => result.status === 'fulfilled');
      assert.ok(first?.status === 'fulfilled');
      userIds.push(first.value.user.id);
      const headers = { authorization: `Bearer ${first.value.accessToken}` };
      assert.equal((await queryHttp('/auth/me', headers)).status, 200);
      const stored = await pool.query<{ code_hash: string; consumed_at: Date; attempts: number }>(
        'SELECT code_hash,consumed_at,attempts FROM auth_otp_challenges WHERE id=$1',
        [challenge.challengeId],
      );
      assert.notEqual(stored.rows[0]!.code_hash, challenge.developmentCode);
      assert.ok(stored.rows[0]!.consumed_at);
      await assert.rejects(
        () => auth.verifyOtp(challenge.challengeId, challenge.developmentCode, ip),
        expect401,
      );

      const driverChallenge = await otp(phones[0]!, 'driver');
      const driver = await auth.verifyOtp(
        driverChallenge.challengeId,
        driverChallenge.developmentCode,
        ip,
      );
      assert.equal(driver.user.id, first.value.user.id);
      assert.deepEqual(new Set(driver.user.roles), new Set(['client', 'driver']));
      const recoveryChallenge = await otp(phones[0]!, 'client', 'recover');
      const recovered = await auth.verifyOtp(
        recoveryChallenge.challengeId,
        recoveryChallenge.developmentCode,
        ip,
      );
      assert.equal((await queryHttp('/auth/me', headers)).status, 401);
      assert.equal(
        (await queryHttp('/auth/me', { authorization: `Bearer ${driver.accessToken}` })).status,
        401,
      );
      const recoveredHeaders = { authorization: `Bearer ${recovered.accessToken}` };
      assert.equal((await queryHttp('/auth/me', recoveredHeaders)).status, 200);

      const exhausted = await otp(phones[1]!, 'driver');
      const wrongCode = exhausted.developmentCode === '999999' ? '888888' : '999999';
      const failures = await Promise.allSettled(
        Array.from({ length: 7 }, () => auth.verifyOtp(exhausted.challengeId, wrongCode, ip)),
      );
      assert.ok(failures.every((result) => result.status === 'rejected'));
      assert.equal(
        (
          await pool.query<{ attempts: number }>(
            'SELECT attempts FROM auth_otp_challenges WHERE id=$1',
            [exhausted.challengeId],
          )
        ).rows[0]!.attempts,
        5,
      );
      await assert.rejects(
        () => auth.verifyOtp(exhausted.challengeId, exhausted.developmentCode, ip),
        expect401,
      );
      const expired = await otp(phones[2]!, 'client');
      await pool.query(
        `UPDATE auth_otp_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1`,
        [expired.challengeId],
      );
      await assert.rejects(
        () => auth.verifyOtp(expired.challengeId, expired.developmentCode, ip),
        expect401,
      );
      await otp(phones[3]!, 'client');
      await assert.rejects(
        () =>
          auth.requestOtp(
            {
              phone: phones[3]!,
              role: 'driver',
              purpose: 'register',
              displayName: 'Otra modalidad',
            },
            ip,
          ),
        (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
      );

      const adminId = randomUUID();
      const mfaSecret = encodeBase32(randomBytes(20));
      await pool.query(
        `INSERT INTO app_users(id,email,display_name,password_hash,totp_secret_cipher) VALUES($1,$2,'Prueba administración',$3,$4)`,
        [
          adminId,
          email,
          await hashPassword('clave extensa para pruebas SQL'),
          encryptTotp(secret, mfaSecret),
        ],
      );
      userIds.push(adminId);
      await pool.query(`INSERT INTO app_user_roles(user_id,role) VALUES($1,'admin')`, [adminId]);
      const code = totpForStep(mfaSecret, Math.floor(Date.now() / 30000));
      const admin = await auth.loginAdmin(email, 'clave extensa para pruebas SQL', code, ip);
      await assert.rejects(
        () => auth.loginAdmin(email, 'clave extensa para pruebas SQL', code, ip),
        expect401,
      );
      const adminHeaders = { cookie: `${config.AUTH_ADMIN_COOKIE_NAME}=${admin.token}` };
      assert.equal((await queryHttp('/admin/users?limit=1&offset=0', adminHeaders)).status, 200);
      assert.equal(
        (await queryHttp('/admin/users', { authorization: `Bearer ${admin.token}` })).status,
        401,
      );
      assert.equal(
        (
          await queryHttp(
            `/admin/users/${first.value.user.id}`,
            adminHeaders,
            { roles: ['client'] },
            'PATCH',
          )
        ).status,
        403,
      );
      const csrfHeaders = { ...adminHeaders, 'x-csrf-token': admin.csrfToken };
      assert.equal(
        (
          await queryHttp(
            `/admin/users/${adminId}`,
            csrfHeaders,
            { roles: ['admin', 'finance'] },
            'PATCH',
          )
        ).status,
        409,
      );
      const roleChange = await queryHttp(
        `/admin/users/${first.value.user.id}`,
        csrfHeaders,
        { roles: ['client', 'admin'] },
        'PATCH',
      );
      assert.equal(roleChange.status, 200);
      assert.deepEqual(
        new Set(((await roleChange.json()) as PublicUser).roles),
        new Set(['client', 'admin']),
      );
      // Even granting a staff role cannot turn a mobile bearer into a staff MFA session.
      assert.equal((await queryHttp('/admin/users', recoveredHeaders)).status, 403);
      const current = await queryHttp('/auth/me', recoveredHeaders);
      assert.deepEqual(
        new Set(((await current.json()) as { user: PublicUser }).user.roles),
        new Set(['client', 'admin']),
      );
      assert.equal(
        (
          await queryHttp(
            `/admin/users/${first.value.user.id}`,
            csrfHeaders,
            { status: 'suspended' },
            'PATCH',
          )
        ).status,
        200,
      );
      assert.equal((await queryHttp('/auth/me', recoveredHeaders)).status, 401);
      assert.equal((await queryHttp('/auth/logout', csrfHeaders, {})).status, 204);
      assert.equal((await queryHttp('/auth/me', adminHeaders)).status, 401);
    } finally {
      await app.close();
      // Delete exactly the fixtures created by this test, without truncating shared tables.
      if (userIds.length) {
        await pool.query(
          'DELETE FROM auth_audit WHERE actor_id=ANY($1::uuid[]) OR target_id=ANY($1::uuid[])',
          [userIds],
        );
        await pool.query('DELETE FROM auth_sessions WHERE user_id=ANY($1::uuid[])', [userIds]);
        await pool.query('DELETE FROM app_user_roles WHERE user_id=ANY($1::uuid[])', [userIds]);
        await pool.query('DELETE FROM app_users WHERE id=ANY($1::uuid[])', [userIds]);
      }
      if (challengeIds.length)
        await pool.query('DELETE FROM auth_otp_challenges WHERE id=ANY($1::uuid[])', [
          challengeIds,
        ]);
      await pool.query('DELETE FROM auth_rate_limits WHERE key=ANY($1::text[])', [
        [
          ...phones.map((phone) => `otp-phone:${phone}`),
          `otp-request-ip:${tokenHash(ip)}`,
          `otp-verify-ip:${tokenHash(ip)}`,
          `staff-email:${tokenHash(email)}`,
          `staff-ip:${tokenHash(ip)}`,
        ],
      ]);
      await pool.end();
    }
  },
);
