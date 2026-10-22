import { resolve } from 'node:path';
import { Client } from 'pg';
import { loadEnvironment } from '../config/environment';
import { AppliedMigration, pendingMigrations, readMigrationFiles } from './migration-files';

async function run(mode: 'up' | 'status'): Promise<void> {
  const env = loadEnvironment();
  const files = await readMigrationFiles(resolve(__dirname, '../../migrations'));
  const client = new Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 3000,
    statement_timeout: 30000,
    query_timeout: 35000,
    application_name: 'appdelivery-migrations',
  });
  let locked = false;
  try {
    await client.connect();
    if (mode === 'up') {
      // The same lock serializes migrators without affecting service tables.
      await client.query('SELECT pg_advisory_lock(6842026, 1)');
      locked = true;
      await client.query(`CREATE TABLE IF NOT EXISTS public.app_schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    }
    const table = await client.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.app_schema_migrations')::text AS table_name",
    );
    const applied = table.rows[0]?.table_name
      ? (
          await client.query<AppliedMigration>(
            'SELECT version, name, checksum FROM public.app_schema_migrations ORDER BY version',
          )
        ).rows
      : [];
    const pending = pendingMigrations(files, applied);
    if (mode === 'status') {
      for (const file of files) {
        process.stdout.write(`${pending.includes(file) ? 'pending' : 'applied'} ${file.name}\n`);
      }
      process.stdout.write(`${applied.length} applied; ${pending.length} pending.\n`);
      return;
    }
    for (const migration of pending) {
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO public.app_schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      process.stdout.write(`Applied ${migration.name}\n`);
    }
    process.stdout.write(`Migrations up to date (${pending.length} applied).\n`);
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(6842026, 1)').catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

const mode = process.argv[2];
if (mode !== 'up' && mode !== 'status') {
  process.stderr.write('Usage: db:migrate (up) or db:status (status).\n');
  process.exitCode = 1;
} else {
  void run(mode).catch((error: unknown) => {
    const safeMessages = [
      'Invalid configuration fields:',
      'Invalid migration filename:',
      'Duplicate migration version:',
      'Applied migration missing from source:',
      'Applied migration was modified:',
      'Out-of-order migration detected.',
    ];
    const message =
      error instanceof Error && safeMessages.some((prefix) => error.message.startsWith(prefix))
        ? error.message
        : 'Database migration failed. Verify PostgreSQL availability, database permissions and SQL migrations.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
