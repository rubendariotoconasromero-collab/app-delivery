import { ConflictException, Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { AppConfig } from '../config/app-config';
import { safeEqual } from './auth.crypto';
import {
  AdminCredentials,
  AuthenticatedUser,
  NewSession,
  OtpChallenge,
  PublicUser,
  UserRole,
  UserStatus,
} from './auth.types';

interface UserRow {
  id: string;
  display_name: string;
  phone: string | null;
  email: string | null;
  status: UserStatus;
  roles: UserRole[];
}

function userFromRow(row: UserRow): PublicUser {
  return {
    id: row.id,
    displayName: row.display_name,
    phone: row.phone,
    email: row.email,
    status: row.status,
    roles: row.roles,
  };
}

const userColumns = `u.id,u.display_name,u.phone,u.email,u.status,
  ARRAY(SELECT role FROM app_user_roles WHERE user_id=u.id ORDER BY role) AS roles`;

export type OtpCompletion = { user: PublicUser } | { error: 'invalid' | 'account' };

@Injectable()
export class AuthRepository implements OnModuleDestroy {
  private readonly pool: Pool;
  constructor(@Inject(AppConfig) config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.values.DATABASE_URL,
      connectionTimeoutMillis: 2500,
      statement_timeout: 10000,
      query_timeout: 12000,
      max: 10,
      application_name: 'appdelivery-auth',
    });
    // Idle socket errors must not crash the process or reveal connection credentials.
    this.pool.on('error', () => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async rateInTransaction(
    client: PoolClient,
    key: string,
    max: number,
    seconds: number,
  ): Promise<boolean> {
    const result = await client.query<{ attempts: number }>(
      `INSERT INTO auth_rate_limits(key,window_start,attempts) VALUES($1,NOW(),1)
       ON CONFLICT(key) DO UPDATE SET
        attempts=CASE WHEN auth_rate_limits.window_start <= NOW()-($2 * INTERVAL '1 second')
          THEN 1 ELSE LEAST(auth_rate_limits.attempts+1,$3+1) END,
        window_start=CASE WHEN auth_rate_limits.window_start <= NOW()-($2 * INTERVAL '1 second')
          THEN NOW() ELSE auth_rate_limits.window_start END
       RETURNING attempts`,
      [key, seconds, max],
    );
    return result.rows[0]!.attempts <= max;
  }

  async rateLimit(key: string, max: number, seconds: number): Promise<boolean> {
    return this.transaction((client) => this.rateInTransaction(client, key, max, seconds));
  }

  async createChallenge(challenge: OtpChallenge, ipKey: string): Promise<boolean> {
    return this.transaction(async (client) => {
      // Cross-instance lock serializes resend limits and identity creation for this phone.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `phone:${challenge.phone}`,
      ]);
      if (!(await this.rateInTransaction(client, ipKey, 20, 3600))) return false;
      if (!(await this.rateInTransaction(client, `otp-phone:${challenge.phone}`, 5, 3600)))
        return false;
      const latest = await client.query(
        `SELECT id FROM auth_otp_challenges WHERE phone=$1 AND created_at > NOW()-INTERVAL '60 seconds' LIMIT 1`,
        [challenge.phone],
      );
      if (latest.rowCount) return false;
      await client.query(
        'UPDATE auth_otp_challenges SET consumed_at=NOW() WHERE phone=$1 AND consumed_at IS NULL',
        [challenge.phone],
      );
      await client.query(
        `INSERT INTO auth_otp_challenges(id,phone,purpose,role,display_name,code_hash,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          challenge.id,
          challenge.phone,
          challenge.purpose,
          challenge.role,
          challenge.displayName ?? null,
          challenge.codeHash,
          challenge.expiresAt,
        ],
      );
      return true;
    });
  }

  async completeOtp(id: string, codeHash: string, session: NewSession): Promise<OtpCompletion> {
    return this.transaction(async (client) => {
      const phone = await client.query<{ phone: string }>(
        'SELECT phone FROM auth_otp_challenges WHERE id=$1',
        [id],
      );
      if (!phone.rows[0]) return { error: 'invalid' };
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `phone:${phone.rows[0].phone}`,
      ]);
      const found = await client.query<{
        phone: string;
        purpose: string;
        role: UserRole;
        display_name: string | null;
        code_hash: string;
        attempts: number;
        expired: boolean;
        consumed_at: Date | null;
      }>(
        `SELECT *,expires_at <= NOW() AS expired FROM auth_otp_challenges WHERE id=$1 FOR UPDATE`,
        [id],
      );
      const challenge = found.rows[0]!;
      if (challenge.consumed_at || challenge.expired || challenge.attempts >= 5)
        return { error: 'invalid' };
      if (!safeEqual(challenge.code_hash, codeHash)) {
        // Commit failed attempts as well. Throwing here would roll back the limit.
        await client.query('UPDATE auth_otp_challenges SET attempts=attempts+1 WHERE id=$1', [id]);
        return { error: 'invalid' };
      }
      await client.query('UPDATE auth_otp_challenges SET consumed_at=NOW() WHERE id=$1', [id]);
      if (challenge.purpose === 'register') {
        await client.query(
          `INSERT INTO app_users(phone,display_name) VALUES($1,$2) ON CONFLICT(phone) DO NOTHING`,
          [challenge.phone, challenge.display_name],
        );
      }
      const foundUser = await client.query<UserRow>(
        `SELECT ${userColumns} FROM app_users u WHERE u.phone=$1 FOR UPDATE`,
        [challenge.phone],
      );
      const row = foundUser.rows[0];
      if (!row || row.status !== 'active') return { error: 'account' };
      if (challenge.purpose === 'register') {
        await client.query(
          'INSERT INTO app_user_roles(user_id,role) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [row.id, challenge.role],
        );
        if (!row.roles.includes(challenge.role)) row.roles.push(challenge.role);
      } else if (!row.roles.includes(challenge.role)) {
        return { error: 'account' };
      }
      if (challenge.purpose === 'recover') {
        await client.query(
          `UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1 AND kind='mobile' AND revoked_at IS NULL`,
          [row.id],
        );
      }
      await this.insertSession(client, row.id, session);
      return { user: userFromRow(row) };
    });
  }

  private async insertSession(
    client: PoolClient,
    userId: string,
    session: NewSession,
  ): Promise<void> {
    await client.query(
      `INSERT INTO auth_sessions(id,user_id,token_hash,kind,mfa_verified,expires_at)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        session.id,
        userId,
        session.tokenHash,
        session.kind,
        session.kind === 'admin',
        session.expiresAt,
      ],
    );
  }

  async sessionByHash(hash: string): Promise<AuthenticatedUser | null> {
    const found = await this.pool.query<
      UserRow & {
        session_id: string;
        kind: 'mobile' | 'admin';
        expires_at: Date;
        mfa_verified: boolean;
      }
    >(
      `SELECT ${userColumns},s.id AS session_id,s.kind,s.expires_at,s.mfa_verified
       FROM auth_sessions s JOIN app_users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>NOW() AND u.status='active'`,
      [hash],
    );
    const row = found.rows[0];
    return row
      ? {
          ...userFromRow(row),
          sessionId: row.session_id,
          sessionKind: row.kind,
          sessionExpiresAt: row.expires_at,
          mfaVerified: row.mfa_verified,
        }
      : null;
  }

  async revokeSession(id: string): Promise<void> {
    await this.pool.query('UPDATE auth_sessions SET revoked_at=NOW() WHERE id=$1', [id]);
  }

  async credentialsByEmail(email: string): Promise<AdminCredentials | null> {
    const found = await this.pool.query<
      UserRow & { password_hash: string | null; totp_secret_cipher: string | null }
    >(
      `SELECT ${userColumns},u.password_hash,u.totp_secret_cipher FROM app_users u WHERE email=$1`,
      [email],
    );
    const row = found.rows[0];
    return row
      ? {
          ...userFromRow(row),
          passwordHash: row.password_hash,
          totpSecretCipher: row.totp_secret_cipher,
        }
      : null;
  }

  async createAdminSession(
    credentials: AdminCredentials,
    step: number,
    session: NewSession,
  ): Promise<PublicUser | null> {
    return this.transaction(async (client) => {
      const found = await client.query<UserRow & { last_totp_step: string | null }>(
        `SELECT ${userColumns},u.last_totp_step FROM app_users u
         WHERE u.id=$1 AND u.password_hash=$2 AND u.totp_secret_cipher=$3 FOR UPDATE`,
        [credentials.id, credentials.passwordHash, credentials.totpSecretCipher],
      );
      const row = found.rows[0];
      if (
        !row ||
        row.status !== 'active' ||
        !row.roles.some((role) => ['admin', 'operator', 'finance'].includes(role)) ||
        (row.last_totp_step !== null && Number(row.last_totp_step) >= step)
      )
        return null;
      await client.query('UPDATE app_users SET last_totp_step=$2 WHERE id=$1', [row.id, step]);
      await this.insertSession(client, row.id, session);
      await client.query(
        `INSERT INTO auth_audit(actor_id,target_id,action) VALUES($1,$1,'staff.login')`,
        [row.id],
      );
      return userFromRow(row);
    });
  }

  async listUsers(limit: number, offset: number): Promise<{ items: PublicUser[]; total: number }> {
    const [rows, count] = await Promise.all([
      this.pool.query<UserRow>(
        `SELECT ${userColumns} FROM app_users u ORDER BY u.created_at DESC,u.id LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM app_users'),
    ]);
    return { items: rows.rows.map(userFromRow), total: Number(count.rows[0]!.count) };
  }

  async updateUser(
    actor: AuthenticatedUser,
    id: string,
    change: { roles?: UserRole[]; status?: UserStatus },
  ): Promise<PublicUser | null> {
    return this.transaction(async (client) => {
      // Serializes administrative membership changes, including the last-admin check.
      await client.query('SELECT pg_advisory_xact_lock(6842026,2)');
      const found = await client.query<UserRow>(
        `SELECT ${userColumns} FROM app_users u WHERE u.id=$1 FOR UPDATE`,
        [id],
      );
      const previous = found.rows[0];
      if (!previous) return null;
      if (actor.id === id && (change.roles || change.status === 'suspended'))
        throw new ConflictException(
          'No puedes modificar tus propios roles ni suspender tu cuenta.',
        );
      const status = change.status ?? previous.status;
      const roles = change.roles ?? previous.roles;
      if (
        previous.status === 'active' &&
        previous.roles.includes('admin') &&
        (status !== 'active' || !roles.includes('admin'))
      ) {
        const count = await client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM app_users u JOIN app_user_roles r ON r.user_id=u.id
           WHERE u.status='active' AND r.role='admin' AND u.id<>$1`,
          [id],
        );
        if (Number(count.rows[0]!.count) === 0)
          throw new ConflictException('Debe permanecer al menos un administrador activo.');
      }
      await client.query('UPDATE app_users SET status=$2,updated_at=NOW() WHERE id=$1', [
        id,
        status,
      ]);
      if (change.roles) {
        await client.query('DELETE FROM app_user_roles WHERE user_id=$1', [id]);
        for (const role of roles)
          await client.query('INSERT INTO app_user_roles(user_id,role) VALUES($1,$2)', [id, role]);
      }
      // Suspended sessions cannot become usable again after reactivation.
      if (status === 'suspended')
        await client.query(
          'UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL',
          [id],
        );
      await client.query(
        `INSERT INTO auth_audit(actor_id,target_id,action,detail) VALUES($1,$2,'user.updated',$3)`,
        [
          actor.id,
          id,
          JSON.stringify({
            before: { roles: previous.roles, status: previous.status },
            after: { roles, status },
          }),
        ],
      );
      return userFromRow({ ...previous, roles, status });
    });
  }
}
