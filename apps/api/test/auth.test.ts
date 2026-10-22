import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthModule, CurrentUser, Public, Roles } from '../src/auth';
import {
  decryptTotp,
  encodeBase32,
  encryptTotp,
  hashPassword,
  otpHash,
  tokenHash,
  totpForStep,
  verifyPassword,
  verifyTotp,
} from '../src/auth/auth.crypto';
import { AuthRepository } from '../src/auth/auth.repository';
import {
  AdminCredentials,
  AuthenticatedUser,
  NewSession,
  OtpChallenge,
  PublicUser,
  publicUser,
} from '../src/auth/auth.types';
import { configureApplication } from '../src/application';
import { AppConfig } from '../src/config/app-config';
import { ConfigModule } from '../src/config/config.module';
import { parseEnvironment } from '../src/config/environment';

const secret = randomBytes(32).toString('base64url');
const values = {
  DATABASE_URL: 'postgresql://unused:secret@127.0.0.1:1/unused',
  REDIS_URL: 'redis://127.0.0.1:1',
  AUTH_SECRET: secret,
  AUTH_OTP_DELIVERY: 'development',
  NODE_ENV: 'test',
};

// The runtime implementation is always PostgreSQL. This isolated test double exercises
// HTTP guards and real cryptography; SQL race handling is tested against PostgreSQL separately.
class TestAuthRepository {
  readonly challenges = new Map<string, OtpChallenge>();
  readonly users = new Map<string, PublicUser>();
  readonly sessions = new Map<string, AuthenticatedUser>();
  credentials: AdminCredentials | null = null;
  lastStep = -1;
  async rateLimit() {
    return true;
  }
  async createChallenge(challenge: OtpChallenge) {
    this.challenges.set(challenge.id, challenge);
    return true;
  }
  async completeOtp(id: string, codeHash: string, session: NewSession) {
    const challenge = this.challenges.get(id);
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt <= new Date() ||
      challenge.attempts >= 5
    )
      return { error: 'invalid' };
    if (challenge.codeHash !== codeHash) {
      challenge.attempts += 1;
      return { error: 'invalid' };
    }
    challenge.consumedAt = new Date();
    let user = [...this.users.values()].find((value) => value.phone === challenge.phone);
    if (!user && challenge.purpose === 'register') {
      user = {
        id: randomUUID(),
        displayName: challenge.displayName!,
        phone: challenge.phone,
        email: null,
        status: 'active',
        roles: [],
      };
      this.users.set(user.id, user);
    }
    if (!user || user.status !== 'active') return { error: 'account' };
    if (challenge.purpose === 'register' && !user.roles.includes(challenge.role))
      user.roles.push(challenge.role);
    if (!user.roles.includes(challenge.role)) return { error: 'account' };
    if (challenge.purpose === 'recover') {
      for (const [key, existing] of this.sessions)
        if (existing.id === user.id && existing.sessionKind === 'mobile') this.sessions.delete(key);
    }
    this.addSession(user, session);
    return { user: publicUser(user) };
  }
  addSession(user: PublicUser, session: NewSession) {
    this.sessions.set(session.tokenHash, {
      ...user,
      sessionId: session.id,
      sessionKind: session.kind,
      sessionExpiresAt: session.expiresAt,
      mfaVerified: session.kind === 'admin',
    });
  }
  async sessionByHash(hash: string) {
    const session = this.sessions.get(hash);
    const user = session ? this.users.get(session.id) : null;
    return session && user?.status === 'active' && session.sessionExpiresAt > new Date()
      ? { ...session, ...user }
      : null;
  }
  async revokeSession(id: string) {
    for (const [key, session] of this.sessions)
      if (session.sessionId === id) this.sessions.delete(key);
  }
  async credentialsByEmail(email: string) {
    return email === this.credentials?.email ? this.credentials : null;
  }
  async createAdminSession(credentials: AdminCredentials, step: number, session: NewSession) {
    if (step <= this.lastStep) return null;
    this.lastStep = step;
    this.addSession(credentials, session);
    return publicUser(credentials);
  }
  async listUsers() {
    return { items: [...this.users.values()], total: this.users.size };
  }
}

@Controller('test-auth')
class TestAuthController {
  @Public() @Get('public') publicRoute() {
    return { ok: true };
  }
  @Get('private') privateRoute(@CurrentUser() user: AuthenticatedUser) {
    return { id: user.id };
  }
  @Roles('client', 'driver') @Get('mobile-role') mobileRole() {
    return { ok: true };
  }
  @Roles('admin') @Post('staff') staff(@Body() body: unknown) {
    return { body };
  }
}
@Module({ imports: [ConfigModule, AuthModule], controllers: [TestAuthController] })
class TestApp {}

async function fixture(overrides: Record<string, unknown> = {}) {
  const repository = new TestAuthRepository();
  const module = await Test.createTestingModule({ imports: [TestApp] })
    .overrideProvider(AppConfig)
    .useValue({ values: parseEnvironment({ ...values, ...overrides }) })
    .overrideProvider(AuthRepository)
    .useValue(repository)
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`;
  const request = async (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    method?: string,
  ) =>
    fetch(`${base}${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  async function otp(
    role: 'client' | 'driver',
    purpose: 'register' | 'login' | 'recover' = 'register',
    phone = '+59170000001',
  ) {
    const challenge = await request('/auth/otp/request', {
      phone,
      purpose,
      role,
      ...(purpose === 'register' ? { displayName: 'Persona de prueba' } : {}),
    });
    assert.equal(challenge.status, 202);
    return (await challenge.json()) as { challengeId: string; developmentCode: string };
  }
  return { app, repository, request, otp };
}

test('RFC HOTP/TOTP vectors and password/MFA encryption use real cryptography', async () => {
  const rfcSecret = encodeBase32(Buffer.from('12345678901234567890'));
  assert.equal(rfcSecret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(totpForStep(rfcSecret, 0), '755224');
  assert.equal(totpForStep(rfcSecret, 1), '287082');
  assert.equal(totpForStep(rfcSecret, 37037037), '050471');
  assert.equal(verifyTotp(rfcSecret, '287082', new Date(59_000)), 1);
  assert.equal(verifyTotp(rfcSecret, '287082', new Date(300_000)), null);
  const encrypted = encryptTotp(secret, rfcSecret);
  assert.equal(decryptTotp(secret, encrypted), rfcSecret);
  assert.notEqual(encryptTotp(secret, rfcSecret), encrypted);
  assert.throws(() => decryptTotp(randomBytes(32).toString('base64url'), encrypted));
  const hashed = await hashPassword('clave larga de prueba');
  assert.equal(await verifyPassword('clave larga de prueba', hashed), true);
  assert.equal(await verifyPassword('otra clave', hashed), false);
  assert.equal(await verifyPassword('clave larga de prueba', null), false);
});

test('phone identity binds the role to a one-use challenge, supports both mobile roles and revokes recovered sessions', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/test-auth/private')).status, 401);
    assert.equal((await f.request('/test-auth/public')).status, 200);
    assert.equal(
      (
        await f.request('/auth/otp/request', {
          phone: '+59170000001',
          purpose: 'register',
          role: 'admin',
          displayName: 'Ataque',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request('/auth/otp/request', {
          phone: '70000001',
          purpose: 'register',
          role: 'client',
          displayName: 'Prueba',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request('/auth/otp/request', {
          phone: '+59170000001',
          purpose: 'register',
          role: 'client',
        })
      ).status,
      400,
    );
    const challenge = await f.otp('client');
    const persisted = f.repository.challenges.get(challenge.challengeId)!;
    assert.notEqual(persisted.codeHash, challenge.developmentCode);
    assert.equal(
      persisted.codeHash,
      otpHash(secret, challenge.challengeId, challenge.developmentCode),
    );
    assert.equal(
      (
        await f.request('/auth/otp/verify', {
          challengeId: challenge.challengeId,
          code: challenge.developmentCode,
          role: 'admin',
        })
      ).status,
      400,
    );
    const verified = await f.request('/auth/otp/verify', {
      challengeId: challenge.challengeId,
      code: challenge.developmentCode,
    });
    assert.equal(verified.status, 200);
    const first = (await verified.json()) as { accessToken: string; user: PublicUser };
    assert.deepEqual(first.user.roles, ['client']);
    assert.equal(
      (
        await f.request('/auth/otp/verify', {
          challengeId: challenge.challengeId,
          code: challenge.developmentCode,
        })
      ).status,
      401,
    );
    const mobileHeaders = { authorization: `Bearer ${first.accessToken}` };
    assert.equal((await f.request('/test-auth/mobile-role', undefined, mobileHeaders)).status, 200);
    assert.equal((await f.request('/test-auth/staff', {}, mobileHeaders)).status, 403);
    const secondChallenge = await f.otp('driver');
    const second = (await (
      await f.request('/auth/otp/verify', {
        challengeId: secondChallenge.challengeId,
        code: secondChallenge.developmentCode,
      })
    ).json()) as { user: PublicUser };
    assert.equal(second.user.id, first.user.id);
    assert.deepEqual(new Set(second.user.roles), new Set(['client', 'driver']));
    const recovery = await f.otp('client', 'recover');
    assert.equal(
      (
        await f.request('/auth/otp/verify', {
          challengeId: recovery.challengeId,
          code: recovery.developmentCode,
        })
      ).status,
      200,
    );
    assert.equal((await f.request('/auth/me', undefined, mobileHeaders)).status, 401);
  } finally {
    await f.app.close();
  }
});

test('expired challenges and five wrong attempts fail closed', async () => {
  const f = await fixture();
  try {
    const expired = await f.otp('driver');
    f.repository.challenges.get(expired.challengeId)!.expiresAt = new Date(0);
    assert.equal(
      (
        await f.request('/auth/otp/verify', {
          challengeId: expired.challengeId,
          code: expired.developmentCode,
        })
      ).status,
      401,
    );
    const locked = await f.otp('driver');
    const wrong = locked.developmentCode === '999999' ? '888888' : '999999';
    for (let i = 0; i < 5; i++)
      assert.equal(
        (await f.request('/auth/otp/verify', { challengeId: locked.challengeId, code: wrong }))
          .status,
        401,
      );
    assert.equal(f.repository.challenges.get(locked.challengeId)!.attempts, 5);
    assert.equal(
      (
        await f.request('/auth/otp/verify', {
          challengeId: locked.challengeId,
          code: locked.developmentCode,
        })
      ).status,
      401,
    );
    assert.equal(f.repository.sessions.size, 0);
  } finally {
    await f.app.close();
  }
});

test('staff requires password and live TOTP; cookie mutations require CSRF, bearer cannot carry an admin session', async () => {
  const f = await fixture();
  try {
    const mfaSecret = encodeBase32(randomBytes(20));
    const user: AdminCredentials = {
      id: randomUUID(),
      displayName: 'Administración',
      email: 'admin@example.test',
      phone: null,
      roles: ['admin'],
      status: 'active',
      passwordHash: await hashPassword('password largo de prueba'),
      totpSecretCipher: encryptTotp(secret, mfaSecret),
    };
    f.repository.credentials = user;
    f.repository.users.set(user.id, publicUser(user));
    assert.equal(
      (
        await f.request('/auth/admin/login', {
          email: user.email,
          password: 'incorrecta',
          totp: '000000',
        })
      ).status,
      401,
    );
    const login = await f.request('/auth/admin/login', {
      email: user.email,
      password: 'password largo de prueba',
      totp: totpForStep(mfaSecret, Math.floor(Date.now() / 30_000)),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    assert.doesNotMatch(cookie, /; Secure/);
    const body = (await login.json()) as {
      csrfToken: string;
      user: PublicUser;
      accessToken?: string;
    };
    assert.equal(body.accessToken, undefined);
    const headers = { cookie: cookie.split(';')[0]! };
    assert.equal((await f.request('/admin/users?limit=101', undefined, headers)).status, 400);
    assert.equal(
      (await f.request('/admin/users?limit=5&offset=0', undefined, headers)).status,
      200,
    );
    assert.equal((await f.request('/test-auth/staff', {}, headers)).status, 403);
    assert.equal(
      (await f.request('/test-auth/staff', {}, { ...headers, 'x-csrf-token': 'invalid' })).status,
      403,
    );
    assert.equal(
      (await f.request('/test-auth/staff', {}, { ...headers, 'x-csrf-token': body.csrfToken }))
        .status,
      201,
    );
    assert.equal(
      (
        await f.request('/admin/users', undefined, {
          authorization: `Bearer ${headers.cookie.split('=')[1]}`,
        })
      ).status,
      401,
    );
    const me = (await (await f.request('/auth/me', undefined, headers)).json()) as {
      csrfToken: string;
    };
    assert.equal(me.csrfToken, body.csrfToken);
    f.repository.users.get(user.id)!.roles = ['operator'];
    assert.equal((await f.request('/admin/users', undefined, headers)).status, 403);
    assert.equal(
      (await f.request('/auth/logout', {}, { ...headers, 'x-csrf-token': body.csrfToken })).status,
      204,
    );
    assert.equal((await f.request('/auth/me', undefined, headers)).status, 401);
    assert.equal(
      (
        await f.request('/auth/admin/login', {
          email: user.email,
          password: 'password largo de prueba',
          totp: totpForStep(mfaSecret, Math.floor(Date.now() / 30_000)),
        })
      ).status,
      401,
      'The same MFA timestep cannot be replayed',
    );
  } finally {
    await f.app.close();
  }
});

test('development OTP is explicit, and production rejects development delivery or missing secret', async () => {
  assert.throws(() => parseEnvironment({ ...values, NODE_ENV: 'production' }), /AUTH_OTP_DELIVERY/);
  assert.throws(
    () =>
      parseEnvironment({
        ...values,
        NODE_ENV: 'production',
        AUTH_OTP_DELIVERY: 'disabled',
        AUTH_SECRET: undefined,
      }),
    /AUTH_SECRET/,
  );
  const f = await fixture({ AUTH_OTP_DELIVERY: 'disabled' });
  try {
    assert.equal(
      (
        await f.request('/auth/otp/request', {
          phone: '+59170000001',
          purpose: 'register',
          role: 'client',
          displayName: 'Persona',
        })
      ).status,
      503,
    );
    assert.equal(f.repository.challenges.size, 0);
  } finally {
    await f.app.close();
  }
});
