import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, isDatabaseReady } from '../src/persistence/database.js';
import { migrate, migrations } from '../src/persistence/migrations.js';

test('real SQLite persists data and migrations across close/reopen with required pragmas', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'flow-database-'));
  context.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  const filename = join(directory, 'nested/db.sqlite');
  let database = openDatabase(filename, 1234);
  assert.equal(
    database.prepare('PRAGMA journal_mode').get()?.journal_mode,
    'wal',
  );
  assert.equal(database.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
  assert.equal(database.prepare('PRAGMA temp_store').get()?.temp_store, 2);
  assert.equal(database.prepare('PRAGMA busy_timeout').get()?.timeout, 1234);
  database.exec(
    "INSERT INTO application_metadata (key, value) VALUES ('persistence-test', 'preserved')",
  );
  database.close();
  database = openDatabase(filename, 1234);
  try {
    assert.equal(
      database
        .prepare(
          "SELECT value FROM application_metadata WHERE key = 'persistence-test'",
        )
        .get()?.value,
      'preserved',
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()
        ?.count,
      migrations.length,
    );
    assert.equal(isDatabaseReady(database), true);
  } finally {
    database.close();
  }
  assert.equal(isDatabaseReady(database), false);
});

test('failed migration rolls back its DDL and version record', () => {
  const database = new DatabaseSync(':memory:');
  try {
    migrate(database);
    assert.throws(() =>
      migrate(database, [
        ...migrations,
        {
          version: migrations.length + 1,
          sql: 'CREATE TABLE should_rollback (id INTEGER); INSERT INTO missing_table VALUES (1);',
        },
      ]),
    );
    assert.equal(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'should_rollback'",
        )
        .get(),
      undefined,
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()
        ?.count,
      migrations.length,
    );
    assert.equal(isDatabaseReady(database), true);
  } finally {
    database.close();
  }
});

test('an unknown migration history is refused without changing it', () => {
  const database = new DatabaseSync(':memory:');
  try {
    migrate(database);
    database.exec('INSERT INTO schema_migrations (version) VALUES (99)');
    assert.throws(
      () => migrate(database),
      /Unsupported database migration history/,
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()
        ?.count,
      migrations.length + 1,
    );
  } finally {
    database.close();
  }
});

test('large existing order bodies upgrade without relying on temporary filesystem writes', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'flow-database-upgrade-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'db.sqlite');
  const legacy = new DatabaseSync(filename);
  const body = JSON.stringify({
    fixture: 'large synthetic body '.repeat(20000),
  });
  try {
    migrate(
      legacy,
      migrations.filter((migration) => migration.version <= 10),
    );
    const insert = legacy.prepare(
      "INSERT INTO production_orders(id,body,body_hash,state,created_at) VALUES (?,?,?,'awaiting-preparation',1)",
    );
    for (const id of ['synthetic-1', 'synthetic-2', 'synthetic-3'])
      insert.run(id, body, 'fixture');
  } finally {
    legacy.close();
  }
  const upgraded = openDatabase(filename, 3000);
  try {
    assert.equal(upgraded.prepare('PRAGMA temp_store').get()?.temp_store, 2);
    assert.deepEqual(
      upgraded
        .prepare(
          'SELECT public_number,body FROM production_orders ORDER BY number',
        )
        .all()
        .map((row) => ({ ...row })),
      [1, 2, 3].map((public_number) => ({ public_number, body })),
    );
    assert.equal(
      upgraded.prepare('SELECT COUNT(*) AS count FROM queue_visibility').get()
        ?.count,
      0,
    );
  } finally {
    upgraded.close();
  }
});
