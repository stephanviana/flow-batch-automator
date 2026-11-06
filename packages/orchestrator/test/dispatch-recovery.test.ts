import assert from 'node:assert/strict';
import { blockedFixture } from './dispatch-recovery-support.js';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { QueueDatabase } from '../src/queue/database.js';
import { QueueRepository } from '../src/queue/repository.js';
import { QueueMutations } from '../src/queue/mutations.js';
import { taskInput } from './queue-support.js';
import { dispatchCommandSchema } from '@flow-batch/protocol';

test('review never dispatches; explicit resume preserves immutable media inputs, records authorization and is idempotent', async (t) => {
  const { f, repository, recovery, order, commandId, headers } =
    await blockedFixture(t);
  const before = dispatchCommandSchema.parse(
    JSON.parse(
      String(
        f.database
          .prepare('SELECT body FROM dispatch_commands WHERE id=?')
          .get(commandId)!.body,
      ),
    ),
  );
  const review = recovery.review(order.number, commandId);
  assert.equal(review.canResume, true);
  assert.equal(review.videos, 3);
  assert.equal(review.images, 1);
  assert.equal(repository.get(order.id).state, 'blocked');
  const denied = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.number}/dispatches/${commandId}/resume`,
    headers,
    payload: {
      reviewHash: review.reviewHash,
      preparationHash: review.preparationHash,
      userAuthorized: false,
    },
  });
  assert.equal(denied.statusCode, 400);
  assert.throws(
    () =>
      recovery.resume(
        order.number,
        commandId,
        '0'.repeat(64),
        review.preparationHash!,
      ),
    /mudou/,
  );
  const result = recovery.resume(
    order.number,
    commandId,
    review.reviewHash,
    review.preparationHash!,
  );
  assert.equal(result.preparationHash, review.preparationHash);
  const after = dispatchCommandSchema.parse(
    JSON.parse(
      String(
        f.database
          .prepare('SELECT body FROM dispatch_commands WHERE id=?')
          .get(commandId)!.body,
      ),
    ),
  );
  assert.deepEqual(after.manifest, before.manifest);
  assert.deepEqual(after.references, before.references);
  assert.equal(
    f.database
      .prepare('SELECT state FROM dispatch_commands WHERE id=?')
      .get(commandId)!.state,
    'pending',
  );
  recovery.resume(
    order.number,
    commandId,
    review.reviewHash,
    review.preparationHash!,
  );
  assert.equal(
    f.database
      .prepare('SELECT COUNT(*) AS count FROM dispatch_recoveries')
      .get()!.count,
    1,
  );
  assert.equal(
    f.database.prepare('SELECT COUNT(*) AS count FROM queue_tasks').get()!
      .count,
    0,
  );
});

test('uncertain creation, revoked identity and any previously registered take prevent recovery', async (t) => {
  const { f, recovery, order, commandId, batchId } = await blockedFixture(t);
  f.database
    .prepare("UPDATE flow_batches SET status='uncertain' WHERE id=?")
    .run(batchId);
  assert.equal(recovery.review(order.number, commandId).canResume, false);
  f.database
    .prepare("UPDATE flow_batches SET status='draft' WHERE id=?")
    .run(batchId);
  const review = recovery.review(order.number, commandId);
  f.database
    .prepare('UPDATE clients SET revoked_at=? WHERE id=?')
    .run(Date.now(), review.clientId);
  assert.equal(recovery.review(order.number, commandId).canResume, false);
  f.database
    .prepare('UPDATE clients SET revoked_at=NULL WHERE id=?')
    .run(review.clientId);
  // The persisted existence of any take is enough to forbid repeating the group, including completed or cancelled ones.
  f.database
    .prepare(
      "INSERT INTO queue_tasks(id,client_id,task_key,input,input_hash,state,attempt_count,max_attempts,created_at,updated_at,next_attempt_at,batch_id) VALUES (?,?,?,'{}','fixture','completed',1,1,1,1,1,?)",
    )
    .run('fixture-task', review.clientId, 'fixture-key', batchId);
  const refused = recovery.review(order.number, commandId);
  assert.equal(refused.canResume, false);
  assert.match(refused.reason, /takes registrados/);
  assert.throws(
    () =>
      recovery.resume(
        order.number,
        commandId,
        refused.reviewHash,
        refused.preparationHash!,
      ),
    /takes registrados/,
  );
});

test('order diagnostics require a management session and explain the blocked stage without mutating dispatches or tasks', async (t) => {
  const { f, repository, order, commandId, headers } = await blockedFixture(t);
  const before = repository.get(order.number);
  const body = f.database
    .prepare('SELECT body FROM dispatch_commands WHERE id=?')
    .get(commandId)!.body;
  const url = `/manage/orders/${order.number}/diagnostics`;
  const denied = await f.app.inject({ url, headers: { host: headers.host! } });
  assert.equal(denied.statusCode, 403);
  const result = await f.app.inject({ url, headers });
  assert.equal(result.statusCode, 200, result.body);
  const diagnostic = result.json();
  assert.equal(diagnostic.preparation.published, true);
  assert.equal(diagnostic.dispatches[0].review.canResume, true);
  assert.deepEqual(diagnostic.dispatches[0].review.failure, {
    stage: 'project-creation',
    code: 'project_wait_ready_failed',
    sent: false,
  });
  assert.match(diagnostic.dispatches[0].message, /projeto não foi criado/);
  assert.deepEqual(diagnostic.tasks, []);
  assert.deepEqual(repository.get(order.number), before);
  assert.equal(
    f.database
      .prepare('SELECT body FROM dispatch_commands WHERE id=?')
      .get(commandId)!.body,
    body,
  );
  assert.equal(
    f.database
      .prepare('SELECT COUNT(*) AS count FROM dispatch_recoveries')
      .get()!.count,
    0,
  );
  assert.equal(
    f.database.prepare('SELECT COUNT(*) AS count FROM queue_tasks').get()!
      .count,
    0,
  );
  assert.equal(
    (await f.app.inject({ url: '/manage/orders/99999/diagnostics', headers }))
      .statusCode,
    404,
  );
});

test('order diagnostics identify interrupted takes with error and stage history while preserving unrelated work', async (t) => {
  const { f, recovery, order, commandId, batchId, headers } =
    await blockedFixture(t);
  const clientId = recovery.review(order.number, commandId).clientId;
  const database = new QueueDatabase(f.database);
  const queue = new QueueRepository(database);
  const [take, unrelated] = queue.enqueue(clientId, randomUUID(), [
    taskInput(),
    taskInput(),
  ]);
  f.database
    .prepare('UPDATE queue_tasks SET batch_id=? WHERE id=?')
    .run(batchId, take!.id);
  queue.control(clientId, true);
  const claimed = queue.claim(take!.id, randomUUID())!;
  new QueueMutations(database).interrupt(
    claimed.connectionId!,
    'server-restart',
  );
  const before = database.detail(take!.id, clientId);
  const response = await f.app.inject({
    url: `/manage/orders/${order.number}/diagnostics`,
    headers,
  });
  assert.equal(response.statusCode, 200, response.body);
  const diagnostic = response.json();
  assert.equal(diagnostic.tasks.length, 1);
  assert.equal(diagnostic.tasks[0].task.id, take!.id);
  assert.equal(diagnostic.tasks[0].task.state, 'uncertain');
  assert.ok(diagnostic.tasks[0].task.lastError.code);
  assert.deepEqual(diagnostic.tasks[0].events, before.events);
  assert.equal('input' in diagnostic.tasks[0], false);
  assert.deepEqual(database.detail(take!.id, clientId), before);
  assert.equal(database.task(unrelated!.id).summary.state, 'queued');
  assert.equal(
    f.database
      .prepare('SELECT COUNT(*) AS count FROM dispatch_recoveries')
      .get()!.count,
    0,
  );
});
