import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { queueFixture, taskInput, progress } from './queue-support.js';
import { signed } from './support.js';
import { QueueVisibility } from '../src/queue/visibility.js';
import { QueueRepository } from '../src/queue/repository.js';
import { QueueDatabase } from '../src/queue/database.js';
import { ClientStore } from '../src/persistence/clients.js';

test('authenticated clearing persists only terminal revisions, preserves history and other clients, and leaves uncertain work blocked', async (t) => {
  const f = await queueFixture(t);
  const [completed, failed, cancelled, uncertain, pending] =
    f.repository.enqueue(
      f.clientId,
      randomUUID(),
      Array.from({ length: 5 }, () => taskInput()),
    );
  assert.ok(completed && failed && cancelled && uncertain && pending);
  f.repository.control(f.clientId, true);
  const connection = randomUUID();
  const claimed = f.repository.claim(completed.id, connection)!;
  for (const state of [
    'submitted',
    'generating',
    'download_pending',
    'completed',
  ] as const)
    f.mutations.progress(
      f.clientId,
      connection,
      progress(completed.id, claimed.activeAttemptId!, state),
    );
  f.database
    .prepare("UPDATE queue_tasks SET state='failed',safe_to_retry=1 WHERE id=?")
    .run(failed.id);
  f.mutations.action(f.clientId, {
    action: 'cancel',
    requestId: randomUUID(),
    taskId: cancelled.id,
    expectedRevision: cancelled.revision,
  });
  f.repository.claim(uncertain.id, connection);
  f.mutations.interrupt(connection);
  const clients = new ClientStore(f.database);
  const other = await clients.request('b'.repeat(32), f.publicKey);
  clients.decide(other.requestId, true);
  const [foreign] = f.repository.enqueue(other.clientId, randomUUID(), [
    taskInput(),
  ]);
  f.database
    .prepare("UPDATE queue_tasks SET state='completed' WHERE id=?")
    .run(foreign!.id);
  const before = [completed, failed, cancelled, uncertain, pending].map(
    (task) => f.queueDatabase.detail(task.id, f.clientId),
  );
  const url = '/api/queue/view';
  assert.equal(
    (await f.app.inject({ method: 'POST', url, payload: {} })).statusCode,
    403,
  );
  const proof = await signed(f, f.clientId, 'POST', url, '{}');
  const cleared = await f.app.inject({
    method: 'POST',
    url,
    headers: proof.headers,
    payload: '{}',
  });
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.equal(cleared.json().cleared, 3);
  assert.equal(new QueueVisibility(f.database).clear(f.clientId), 0);
  assert.deepEqual(
    [completed, failed, cancelled, uncertain, pending].map((task) =>
      f.queueDatabase.detail(task.id, f.clientId),
    ),
    before,
  );
  assert.equal(f.repository.snapshot(f.clientId).tasks.length, 5);
  assert.equal(f.repository.snapshot(other.clientId, true).tasks.length, 1);
  const fresh = new DatabaseSync(f.config.databasePath);
  try {
    const view = new QueueRepository(new QueueDatabase(fresh)).snapshot(
      f.clientId,
      true,
    );
    assert.equal(view.blockedByReview, true);
    assert.deepEqual(
      view.tasks.map((task) => task.id),
      [uncertain.id, pending.id],
    );
    assert.equal(
      view.counts.completed + view.counts.failed + view.counts.cancelled,
      0,
    );
  } finally {
    fresh.close();
  }
  f.mutations.action(f.clientId, {
    action: 'retry',
    requestId: randomUUID(),
    taskId: failed.id,
    expectedRevision: f.queueDatabase.task(failed.id).summary.revision,
    acknowledgeDuplicateRisk: false,
  });
  assert.ok(
    f.repository
      .snapshot(f.clientId, true)
      .tasks.some((task) => task.id === failed.id && task.state === 'queued'),
  );
  const get = await signed(f, f.clientId, 'GET', url);
  assert.equal(
    (await f.app.inject({ url, headers: get.headers })).json().counts.queued,
    2,
  );
});
