import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { migrate, migrations } from '../src/persistence/migrations.js';
import { ClientStore } from '../src/persistence/clients.js';
import { fixture, signed } from './support.js';
import { queueFixture, taskInput } from './queue-support.js';

test('phase 2 SQLite upgrades without losing authorization or diagnostic history', async (t) => {
  const f = await fixture(t);
  const filename = f.config.databasePath + '.phase2';
  const legacy = new DatabaseSync(filename);
  migrate(
    legacy,
    migrations.filter((step) => step.version <= 2),
  );
  const clientId = randomUUID();
  const simulationId = randomUUID();
  const now = Date.now();
  legacy
    .prepare(
      'INSERT INTO clients (id,extension_id,public_key,fingerprint,authorized_at) VALUES (?,?,?,?,?)',
    )
    .run(
      clientId,
      f.extensionId,
      JSON.stringify(f.publicKey),
      'upgrade-fixture',
      now,
    );
  legacy
    .prepare(
      "INSERT INTO simulations (id,client_id,connection_id,request_id,duration_ms,state,created_at,updated_at) VALUES (?,?,?,?,100,'completed',?,?)",
    )
    .run(simulationId, clientId, randomUUID(), randomUUID(), now, now);
  legacy.close();
  const app = createApp({ ...f.config, databasePath: filename });
  try {
    const proof = await signed({ ...f, app }, clientId, 'GET', '/api/identity');
    assert.equal(
      (await app.inject({ url: '/api/identity', headers: proof.headers }))
        .statusCode,
      200,
    );
    const database = new DatabaseSync(filename, { readOnly: true });
    try {
      assert.deepEqual(
        database
          .prepare('SELECT version FROM schema_migrations ORDER BY version')
          .all()
          .map((row) => row.version),
        [1, 2, 3],
      );
      assert.equal(
        database
          .prepare('SELECT state FROM simulations WHERE id=?')
          .get(simulationId)?.state,
        'completed',
      );
      assert.equal(
        database.prepare('SELECT COUNT(*) AS count FROM queue_tasks').get()
          ?.count,
        0,
      );
    } finally {
      database.close();
    }
  } finally {
    await app.close();
  }
});

test('global single-active and uncertain-result barrier also apply across authorized identities without leaking tasks', async (t) => {
  const f = await queueFixture(t);
  const clients = new ClientStore(f.database);
  const second = await clients.request('b'.repeat(32), f.publicKey);
  clients.decide(second.requestId, true);
  const [firstTask] = f.repository.enqueue(f.clientId, randomUUID(), [
    taskInput(),
  ]);
  const [secondTask] = f.repository.enqueue(second.clientId, randomUUID(), [
    taskInput(),
  ]);
  assert.ok(firstTask && secondTask);
  f.repository.control(f.clientId, true);
  f.repository.control(second.clientId, true);
  const connectionId = randomUUID();
  assert.ok(f.repository.claim(firstTask.id, connectionId));
  assert.equal(f.repository.claim(secondTask.id, randomUUID()), undefined);
  f.mutations.interrupt(connectionId);
  assert.equal(f.repository.candidate([second.clientId]), undefined);
  const snapshot = f.repository.snapshot(second.clientId);
  assert.equal(snapshot.blockedByReview, true);
  assert.deepEqual(
    snapshot.tasks.map((task) => task.id),
    [secondTask.id],
  );
  assert.throws(
    () => f.queueDatabase.detail(firstTask.id, second.clientId),
    /not found/,
  );
  assert.throws(
    () =>
      f.mutations.action(second.clientId, {
        action: 'resolve',
        requestId: randomUUID(),
        taskId: firstTask.id,
        expectedRevision: f.queueDatabase.task(firstTask.id).summary.revision,
        outcome: 'completed',
        note: 'Wrong owner',
      }),
    /not found/,
  );
});
