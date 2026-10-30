import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  batchActionReplySchema,
  batchListSchema,
  type Batch,
} from '@flow-batch/protocol';
import { BatchStore } from '../src/persistence/batches.js';
import { ClientStore } from '../src/persistence/clients.js';
import { migrate, migrations } from '../src/persistence/migrations.js';
import { QueueDatabase } from '../src/queue/database.js';
import { QueueRepository } from '../src/queue/repository.js';
import { queueFixture } from './queue-support.js';
import { flowInput } from './flow-support.js';
import { signed } from './support.js';

function prepare(
  store: BatchStore,
  clientId: string,
  mode: 'new-project' | 'existing-project' = 'new-project',
): Batch {
  const draft = { id: randomUUID(), name: 'Produto · campanha', mode };
  return store.action(clientId, { action: 'prepare', draft }).batch;
}

test('signed batch API persists draft idempotently and grants creation only once', async (t) => {
  const f = await queueFixture(t);
  const draft = { id: randomUUID(), name: 'Campanha A', mode: 'new-project' };
  const post = async (
    input: unknown,
  ): Promise<Awaited<ReturnType<typeof f.app.inject>>> => {
    const body = JSON.stringify(input);
    const proof = await signed(f, f.clientId, 'POST', '/api/batches', body);
    return f.app.inject({
      method: 'POST',
      url: '/api/batches',
      headers: proof.headers,
      payload: body,
    });
  };
  const first = await post({ action: 'prepare', draft });
  assert.equal(first.statusCode, 200, first.body);
  assert.deepEqual(
    (await post({ action: 'prepare', draft })).json(),
    first.json(),
  );
  assert.equal(
    (await post({ action: 'prepare', draft: { ...draft, name: 'Changed' } }))
      .statusCode,
    409,
  );
  const claim = batchActionReplySchema.parse(
    (await post({ action: 'claim', id: draft.id, expectedRevision: 0 })).json(),
  );
  assert.ok(claim.attemptId);
  const duplicate = batchActionReplySchema.parse(
    (await post({ action: 'claim', id: draft.id, expectedRevision: 0 })).json(),
  );
  assert.equal(duplicate.attemptId, undefined);
  assert.equal(duplicate.batch.status, 'creating');
  const projectId = randomUUID();
  const settled = await post({
    action: 'settle',
    id: draft.id,
    attemptId: claim.attemptId,
    outcome: 'ready',
    projectId,
  });
  assert.equal(settled.statusCode, 200, settled.body);
  assert.deepEqual(
    (
      await post({
        action: 'settle',
        id: draft.id,
        attemptId: claim.attemptId,
        outcome: 'ready',
        projectId,
      })
    ).json(),
    settled.json(),
  );
  const proof = await signed(f, f.clientId, 'GET', '/api/batches');
  const response = await f.app.inject({
    url: '/api/batches',
    headers: proof.headers,
  });
  const list = batchListSchema.parse(response.json());
  assert.equal(list.batches[0]?.projectId, projectId);
  assert.equal(JSON.stringify(list).includes(claim.attemptId), false);
  assert.notEqual(
    (await f.app.inject({ url: '/api/batches', headers: f.headers }))
      .statusCode,
    200,
  );
});

test('uncertain creation cannot create again; late receipt or explicit attachment recovers immutable binding', async (t) => {
  const f = await queueFixture(t);
  const store = new BatchStore(f.database);
  const batch = prepare(store, f.clientId);
  const claim = store.action(f.clientId, {
    action: 'claim',
    id: batch.id,
    expectedRevision: 0,
  });
  assert.ok(claim.attemptId);
  store.interrupt();
  assert.equal(store.get(f.clientId, batch.id).status, 'uncertain');
  assert.equal(
    store.action(f.clientId, {
      action: 'claim',
      id: batch.id,
      expectedRevision: 2,
    }).attemptId,
    undefined,
  );
  const projectId = randomUUID();
  store.action(f.clientId, {
    action: 'settle',
    id: batch.id,
    attemptId: claim.attemptId,
    outcome: 'ready',
    projectId,
  });
  assert.equal(store.get(f.clientId, batch.id).projectId, projectId);
  assert.throws(
    () =>
      store.action(f.clientId, {
        action: 'attach',
        id: batch.id,
        expectedRevision: 3,
        projectId: randomUUID(),
      }),
    /immutable/,
  );
  const other = prepare(store, f.clientId);
  const pending = store.action(f.clientId, {
    action: 'claim',
    id: other.id,
    expectedRevision: 0,
  });
  assert.ok(pending.attemptId);
  // Explicit review can recover even if a worker died before reporting uncertainty.
  const reviewed = store.action(f.clientId, {
    action: 'attach',
    id: other.id,
    expectedRevision: 1,
    projectId: randomUUID(),
  });
  assert.equal(reviewed.batch.status, 'ready');
  assert.throws(
    () =>
      store.action(f.clientId, {
        action: 'settle',
        id: other.id,
        attemptId: pending.attemptId!,
        outcome: 'ready',
        projectId: randomUUID(),
      }),
    /attempt changed/,
  );
});

test('only known pre-send failure permits another explicit creation attempt', async (t) => {
  const f = await queueFixture(t);
  const store = new BatchStore(f.database);
  const batch = prepare(store, f.clientId);
  const first = store.action(f.clientId, {
    action: 'claim',
    id: batch.id,
    expectedRevision: 0,
  });
  assert.ok(first.attemptId);
  store.action(f.clientId, {
    action: 'settle',
    id: batch.id,
    attemptId: first.attemptId,
    outcome: 'not-created',
  });
  const next = store.action(f.clientId, {
    action: 'claim',
    id: batch.id,
    expectedRevision: 2,
  });
  assert.ok(next.attemptId);
  assert.notEqual(next.attemptId, first.attemptId);
  assert.throws(
    () =>
      store.action(f.clientId, {
        action: 'settle',
        id: batch.id,
        attemptId: first.attemptId!,
        outcome: 'ready',
        projectId: randomUUID(),
      }),
    /attempt changed/,
  );
});

test('queue binds takes to the owner batch project and preserves original legacy takes', async (t) => {
  const f = await queueFixture(t);
  const store = new BatchStore(f.database);
  const legacy = flowInput();
  const [oldTask] = f.repository.enqueue(f.clientId, randomUUID(), [legacy]);
  assert.ok(oldTask);
  const batch = prepare(store, f.clientId, 'existing-project');
  const input = flowInput();
  input.flow.batchId = batch.id;
  assert.throws(
    () => f.repository.enqueue(f.clientId, randomUUID(), [input]),
    /does not match/,
  );
  store.action(f.clientId, {
    action: 'attach',
    id: batch.id,
    expectedRevision: 0,
    projectId: input.flow.projectId,
  });
  const [task] = f.repository.enqueue(f.clientId, randomUUID(), [input]);
  assert.equal(task?.batchId, batch.id);
  assert.equal(task?.batchName, batch.name);
  const wrongProject = flowInput();
  wrongProject.flow.batchId = batch.id;
  assert.throws(
    () => f.repository.enqueue(f.clientId, randomUUID(), [wrongProject]),
    /does not match/,
  );
  const second = await new ClientStore(f.database).request(
    'b'.repeat(32),
    f.publicKey,
  );
  assert.equal(store.list(second.clientId).length, 0);
  assert.throws(() => store.get(second.clientId, batch.id), /not found/);
  assert.throws(
    () => f.repository.enqueue(second.clientId, randomUUID(), [input]),
    /not found/,
  );
  assert.deepEqual(
    f.queueDatabase.detail(oldTask.id, f.clientId).input,
    legacy,
  );
  assert.equal(f.queueDatabase.task(oldTask.id).summary.batchId, undefined);
});

test('sequential dispatch preserves distinct batch projects even after switching batches', async (t) => {
  const f = await queueFixture(t);
  const store = new BatchStore(f.database);
  const inputs = [flowInput(), flowInput()];
  for (const input of inputs) {
    const batch = prepare(store, f.clientId, 'existing-project');
    store.action(f.clientId, {
      action: 'attach',
      id: batch.id,
      expectedRevision: 0,
      projectId: input.flow.projectId,
    });
    input.flow.batchId = batch.id;
    f.repository.enqueue(f.clientId, randomUUID(), [input]);
  }
  f.repository.control(f.clientId, true);
  for (const input of inputs) {
    const next = f.repository.candidate([f.clientId], [f.clientId]);
    assert.ok(next);
    const connectionId = randomUUID();
    const claimed = f.repository.claim(next.summary.id, connectionId);
    assert.ok(claimed?.activeAttemptId);
    assert.deepEqual(claimed.input, input);
    f.mutations.progress(f.clientId, connectionId, {
      type: 'queue-progress',
      taskId: next.summary.id,
      attemptId: claimed.activeAttemptId,
      state: 'failed',
      error: {
        code: 'fixture',
        message: 'Before send',
        notSubmitted: true,
        retryable: false,
      },
    });
  }
  assert.equal(f.repository.candidate([f.clientId], [f.clientId]), undefined);
});

test('migration from version 4 leaves existing task input, IDs and project unchanged', async (t) => {
  const f = await queueFixture(t);
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  migrate(
    db,
    migrations.filter((step) => step.version <= 4),
  );
  db.prepare('INSERT INTO clients SELECT ?,?,?,?,?,NULL').run(
    f.clientId,
    f.extensionId,
    JSON.stringify(f.publicKey),
    'fixture',
    Date.now(),
  );
  const input = flowInput();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO queue_tasks (id,client_id,task_key,input,input_hash,state,max_attempts,created_at,updated_at,next_attempt_at) VALUES (?,?,?,?,?,'queued',1,1,1,1)",
  ).run(id, f.clientId, input.taskKey, JSON.stringify(input), 'fixture');
  migrate(db);
  const repo = new QueueRepository(new QueueDatabase(db));
  assert.deepEqual(repo.database.detail(id, f.clientId).input, input);
  assert.equal(
    db.prepare('SELECT batch_id FROM queue_tasks WHERE id=?').get(id)?.batch_id,
    null,
  );
  assert.deepEqual(new BatchStore(db).list(f.clientId), []);
});
