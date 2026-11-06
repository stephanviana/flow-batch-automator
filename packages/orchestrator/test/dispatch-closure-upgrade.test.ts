import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { migrate, migrations } from '../src/persistence/migrations.js';

test('the closure migration preserves existing blocked commands and introduces an empty audited relation', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('PRAGMA foreign_keys=ON');
    migrate(
      database,
      migrations.filter((migration) => migration.version <= 9),
    );
    const clientId = randomUUID(),
      dispatchId = randomUUID();
    database
      .prepare(
        'INSERT INTO clients(id,extension_id,public_key,fingerprint,authorized_at) VALUES (?,?,?,?,?)',
      )
      .run(clientId, 'a'.repeat(32), '{}', 'synthetic', 1);
    database
      .prepare(
        'INSERT INTO dispatch_commands(id,client_id,body,body_hash,state,message,created_at,failure) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(
        dispatchId,
        clientId,
        '{"fixture":"immutable"}',
        'synthetic-hash',
        'blocked',
        'Original failure',
        1,
        '{"stage":"project-creation","code":"fixture","sent":false}',
      );
    const before = database.prepare('SELECT * FROM dispatch_commands').all();
    migrate(database);
    assert.deepEqual(
      database.prepare('SELECT * FROM dispatch_commands').all(),
      before,
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM dispatch_closures').get()!
        .count,
      0,
    );
    assert.throws(
      () =>
        database
          .prepare(
            'INSERT INTO dispatch_closures(dispatch_id,review_hash,preparation_hash,note,closed_at) VALUES (?,?,?,?,?)',
          )
          .run(randomUUID(), 'r', 'p', 'Synthetic closure', 2),
      /FOREIGN KEY/,
    );
    migrate(database);
    assert.deepEqual(
      database.prepare('SELECT * FROM dispatch_commands').all(),
      before,
    );
  } finally {
    database.close();
  }
});
