import assert from 'node:assert/strict';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pendingMigrations, readMigrationFiles } from '../src/database/migration-files';

test('migration plan is ordered, repeatable and rejects modified applied SQL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'appdelivery-migrations-'));
  const first = '0001_enable_postgis.sql';
  const second = '0002_example.sql';
  try {
    await writeFile(join(directory, second), 'SELECT 2;');
    await writeFile(join(directory, first), 'CREATE EXTENSION IF NOT EXISTS postgis;');
    const files = await readMigrationFiles(directory);
    assert.deepEqual(
      files.map((file) => file.name),
      [first, second],
    );
    assert.equal(pendingMigrations(files, files).length, 0);
    assert.deepEqual(
      pendingMigrations(files, [files[0]!]).map((file) => file.name),
      [second],
    );
    await writeFile(join(directory, first), 'SELECT 100;');
    assert.throws(() => pendingMigrations([], [files[0]!]), /missing from source/);
    assert.throws(() => pendingMigrations(files, [files[1]!]), /Out-of-order/);
    assert.throws(
      () => pendingMigrations([{ ...files[0]!, checksum: 'changed' }, files[1]!], [files[0]!]),
      /was modified/,
    );
    assert.notEqual((await readMigrationFiles(directory))[0]!.checksum, files[0]!.checksum);
  } finally {
    await unlink(join(directory, first));
    await unlink(join(directory, second));
    await rmdir(directory);
  }
});

test('duplicate SQL migration versions are rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'appdelivery-migrations-'));
  try {
    await writeFile(join(directory, '0001_one.sql'), 'SELECT 1;');
    await writeFile(join(directory, '0001_two.sql'), 'SELECT 2;');
    await assert.rejects(() => readMigrationFiles(directory), /Duplicate migration version/);
  } finally {
    await unlink(join(directory, '0001_one.sql'));
    await unlink(join(directory, '0001_two.sql'));
    await rmdir(directory);
  }
});
