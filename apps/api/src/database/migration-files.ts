import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type MigrationFile = {
  version: string;
  name: string;
  checksum: string;
  sql: string;
};

export type AppliedMigration = { version: string; name: string; checksum: string };

export async function readMigrationFiles(directory: string): Promise<MigrationFile[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  const versions = new Set<string>();
  const migrations: MigrationFile[] = [];
  for (const name of names) {
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(name);
    if (!match?.[1]) throw new Error(`Invalid migration filename: ${name}`);
    const version = match[1];
    if (versions.has(version)) throw new Error(`Duplicate migration version: ${version}`);
    versions.add(version);
    const sql = await readFile(join(directory, name), 'utf8');
    migrations.push({
      version,
      name,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  return migrations;
}

export function pendingMigrations(
  files: MigrationFile[],
  applied: AppliedMigration[],
): MigrationFile[] {
  const filesByVersion = new Map(files.map((file) => [file.version, file]));
  for (const row of applied) {
    const file = filesByVersion.get(row.version);
    if (!file) throw new Error(`Applied migration missing from source: ${row.version}`);
    if (file.checksum !== row.checksum || file.name !== row.name) {
      throw new Error(`Applied migration was modified: ${row.version}`);
    }
  }
  const appliedVersions = new Set(applied.map((row) => row.version));
  const lastAppliedVersion = applied
    .map((row) => row.version)
    .sort()
    .at(-1);
  const pending = files.filter((file) => !appliedVersions.has(file.version));
  if (lastAppliedVersion && pending.some((file) => file.version < lastAppliedVersion)) {
    throw new Error(
      'Out-of-order migration detected. Add a new version after the latest applied version.',
    );
  }
  return pending;
}
