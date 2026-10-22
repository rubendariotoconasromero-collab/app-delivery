import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Client } from 'pg';
import { z } from 'zod';
import { encodeBase32, encryptTotp, hashPassword } from '../src/auth/auth.crypto';
import { loadEnvironment } from '../src/config/environment';

async function main(): Promise<void> {
  const flags = new Map<string, string>();
  const allowed = ['--email', '--name', '--roles', '--password-file', '--mfa-output'];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!;
    const value = args[i + 1];
    if (!allowed.includes(key) || flags.has(key) || !value || value.startsWith('--'))
      throw new Error('arguments');
    flags.set(key, value);
  }
  if (flags.size !== allowed.length) throw new Error('arguments');
  const email = z.email().max(254).parse(flags.get('--email')).toLowerCase();
  const name = z.string().trim().min(2).max(100).parse(flags.get('--name'));
  const roles = z
    .array(z.enum(['admin', 'operator', 'finance']))
    .min(1)
    .max(3)
    .refine((value) => new Set(value).size === value.length)
    .parse(flags.get('--roles')!.split(','));
  // Passwords never pass through process arguments, logs, source files or environment defaults.
  const password = (await readFile(resolve(flags.get('--password-file')!), 'utf8')).replace(
    /\r?\n$/,
    '',
  );
  if (password.length < 14 || password.length > 1024) throw new Error('password length');
  const env = loadEnvironment();
  if (!env.AUTH_SECRET || Buffer.from(env.AUTH_SECRET, 'base64url').length < 32)
    throw new Error('secret');
  const output = resolve(flags.get('--mfa-output')!);
  const secret = encodeBase32(randomBytes(20));
  const issuer = 'AppDelivery';
  const enrollment = {
    email,
    secret,
    otpauthUri: `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
    instructions:
      'Add this account to an authenticator. Keep this enrollment secret in protected offline storage; possession allows generating MFA codes. Remove the local provisioning file after enrollment and backup. There are no default passwords or MFA bypass codes.',
  };
  const passwordHash = await hashPassword(password);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(enrollment, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const client = new Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10000,
  });
  try {
    await client.connect();
    await client.query('BEGIN');
    const created = await client.query<{ id: string }>(
      `INSERT INTO app_users(email,display_name,password_hash,totp_secret_cipher) VALUES($1,$2,$3,$4) RETURNING id`,
      [email, name, passwordHash, encryptTotp(env.AUTH_SECRET, secret)],
    );
    const id = created.rows[0]!.id;
    for (const role of roles)
      await client.query('INSERT INTO app_user_roles(user_id,role) VALUES($1,$2)', [id, role]);
    await client.query(
      `INSERT INTO auth_audit(actor_id,target_id,action,detail) VALUES($1,$1,'staff.bootstrap',$2)`,
      [id, JSON.stringify({ roles })],
    );
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    // A lost COMMIT acknowledgement is ambiguous. Preserve the MFA enrollment so
    // an account that did commit never becomes inaccessible through local cleanup.
    throw new Error('database');
  } finally {
    await client.end().catch(() => undefined);
  }
  process.stdout.write(`Staff account created. MFA enrollment saved locally to ${output}\n`);
}

void main().catch(() => {
  process.stderr.write(
    'Staff creation failed. Use --email EMAIL --name NAME --roles admin[,operator,finance] --password-file FILE --mfa-output NEW_FILE. Check the database, unique email, AUTH_SECRET and a password of at least 14 characters. Any created MFA enrollment file is preserved; verify account creation before retrying. Secrets are never printed.\n',
  );
  process.exitCode = 1;
});
