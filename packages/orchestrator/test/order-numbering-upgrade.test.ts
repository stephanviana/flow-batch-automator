import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { migrate, migrations } from '../src/persistence/migrations.js';

test('workflow clearing migration preserves old order numbers, bodies and relations without clearing anything', () => {
  const database = new DatabaseSync(':memory:');
  try {
    migrate(
      database,
      migrations.filter((migration) => migration.version <= 10),
    );
    const insert = database.prepare(
      "INSERT INTO production_orders(id,body,body_hash,state,created_at) VALUES (?,?,?,'awaiting-preparation',?)",
    );
    for (let number = 1; number <= 3; number++)
      insert.run(
        randomUUID(),
        JSON.stringify({ immutable: number }),
        `hash-${number}`,
        1,
      );
    const before = database
      .prepare('SELECT number,id,body,body_hash,state FROM production_orders')
      .all();
    migrate(database);
    migrate(database);
    assert.deepEqual(
      database
        .prepare('SELECT number,id,body,body_hash,state FROM production_orders')
        .all(),
      before,
    );
    assert.deepEqual(
      database
        .prepare(
          'SELECT public_number,number_cycle,archived_at FROM production_orders',
        )
        .all()
        .map((row) => ({ ...row })),
      [1, 2, 3].map((public_number) => ({
        public_number,
        number_cycle: 0,
        archived_at: null,
      })),
    );
    assert.equal(
      database
        .prepare(
          "SELECT value FROM application_metadata WHERE key='orders_cycle'",
        )
        .get()!.value,
      '0',
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM queue_visibility').get()!
        .count,
      0,
    );
    database
      .prepare(
        "INSERT INTO production_orders(id,body,body_hash,state,created_at,public_number,number_cycle) VALUES (?,?,?,'awaiting-preparation',?,1,1)",
      )
      .run(randomUUID(), '{}', 'another', 2);
    assert.equal(
      database
        .prepare(
          'SELECT COUNT(*) AS count FROM production_orders WHERE public_number=1',
        )
        .get()!.count,
      2,
    );
  } finally {
    database.close();
  }
});
