import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { blockedFixture } from './dispatch-recovery-support.js';
import { DispatchClosure } from '../src/orders/dispatch-closure.js';
import { ClientStore } from '../src/persistence/clients.js';
import { DispatchStore } from '../src/persistence/dispatch.js';
import { QueueDatabase } from '../src/queue/database.js';
import { QueueRepository } from '../src/queue/repository.js';
import { QueueMutations } from '../src/queue/mutations.js';
import { flowInput } from './flow-support.js';
import { taskInput, progress } from './queue-support.js';

test('closing a reviewed group is authenticated, idempotent and preserves its immutable command and audit history', async (t) => {
  const { f, repository, recovery, order, commandId, headers } =
    await blockedFixture(t);
  const review = recovery.review(order.number, commandId);
  assert.equal(review.canClose, true);
  const input = {
    reviewed: true,
    reviewHash: review.reviewHash,
    preparationHash: review.preparationHash!,
    note: 'Não gerar este grupo novamente.',
  };
  const url = `/manage/orders/${order.number}/dispatches/${commandId}/close`;
  const before = f.database
    .prepare('SELECT * FROM dispatch_commands WHERE id=?')
    .get(commandId);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url,
        headers: { host: headers.host! },
        payload: input,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url,
        headers,
        payload: { ...input, reviewed: false },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url,
        headers,
        payload: { ...input, note: ' ' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url,
        headers,
        payload: { ...input, reviewHash: '0'.repeat(64) },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url,
        headers,
        payload: { ...input, preparationHash: '0'.repeat(64) },
      })
    ).statusCode,
    409,
  );
  const response = await f.app.inject({
    method: 'POST',
    url,
    headers,
    payload: input,
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().state, 'cancelled');
  assert.equal(repository.get(order.number).dispatches[0]!.state, 'cancelled');
  assert.equal(
    repository.get(order.number).dispatches[0]!.closure!.note,
    input.note,
  );
  assert.deepEqual(
    f.database
      .prepare('SELECT * FROM dispatch_commands WHERE id=?')
      .get(commandId),
    before,
  );
  assert.equal(new DispatchStore(f.database).list(review.clientId).length, 0);
  assert.equal(recovery.review(order.number, commandId).canResume, false);
  assert.equal(
    (await f.app.inject({ method: 'POST', url, headers, payload: input }))
      .statusCode,
    200,
  );
  assert.equal(
    f.database.prepare('SELECT COUNT(*) AS count FROM dispatch_closures').get()!
      .count,
    1,
  );
  assert.equal(
    f.database.prepare('SELECT COUNT(*) AS count FROM queue_tasks').get()!
      .count,
    0,
  );
  assert.equal(
    f.database
      .prepare('SELECT COUNT(*) AS count FROM dispatch_recoveries')
      .get()!.count,
    0,
  );
  const closedBatch = f.database
    .prepare('SELECT batch_id FROM order_dispatches WHERE dispatch_id=?')
    .get(commandId)!;
  const newTake = flowInput();
  newTake.flow.batchId = String(closedBatch.batch_id);
  assert.throws(
    () =>
      new QueueRepository(new QueueDatabase(f.database)).enqueue(
        review.clientId,
        randomUUID(),
        [newTake],
      ),
    /encerrado/,
  );
  assert.throws(
    () =>
      recovery.resume(
        order.number,
        commandId,
        review.reviewHash,
        review.preparationHash!,
      ),
    /mudou/,
  );
});

test('closing preserves completed takes and reports the order as partially ended rather than inventing completion', async (t) => {
  const { f, repository, recovery, order, commandId, batchId } =
    await blockedFixture(t);
  const clientId = recovery.review(order.number, commandId).clientId;
  const database = new QueueDatabase(f.database),
    queue = new QueueRepository(database),
    mutations = new QueueMutations(database);
  const [take] = queue.enqueue(clientId, randomUUID(), [taskInput()]);
  f.database
    .prepare('UPDATE queue_tasks SET batch_id=? WHERE id=?')
    .run(batchId, take!.id);
  queue.control(clientId, true);
  const connectionId = randomUUID();
  const claimed = queue.claim(take!.id, connectionId)!;
  for (const state of [
    'submitted',
    'generating',
    'download_pending',
    'completed',
  ] as const)
    mutations.progress(
      clientId,
      connectionId,
      progress(take!.id, claimed.activeAttemptId!, state),
    );
  const originalTake = database.detail(take!.id, clientId);
  const originalPreparation = repository.get(order.number).preparation;
  const review = recovery.review(order.number, commandId);
  assert.equal(review.canResume, false);
  assert.equal(review.canClose, true);
  const closed = new DispatchClosure(
    repository,
    new ClientStore(f.database),
  ).close(order.number, commandId, {
    reviewHash: review.reviewHash,
    preparationHash: review.preparationHash!,
    note: 'Preservar o take pronto e encerrar os restantes.',
  });
  assert.equal(closed.state, 'failed');
  assert.equal(closed.counts.completed, 1);
  assert.equal(closed.counts.cancelled ?? 0, 0);
  assert.deepEqual(closed.preparation, originalPreparation);
  assert.deepEqual(database.detail(take!.id, clientId), originalTake);
  assert.equal(
    f.database.prepare('SELECT COUNT(*) AS count FROM queue_tasks').get()!
      .count,
    1,
  );
});

test('pending work and uncertain outcomes cannot be hidden by closing a group; a changed take invalidates the review', async (t) => {
  const { f, repository, recovery, order, commandId, batchId } =
    await blockedFixture(t);
  const before = recovery.review(order.number, commandId);
  const database = new QueueDatabase(f.database),
    queue = new QueueRepository(database),
    mutations = new QueueMutations(database);
  const closure = new DispatchClosure(repository, new ClientStore(f.database));
  const [take] = queue.enqueue(before.clientId, randomUUID(), [taskInput()]);
  f.database
    .prepare('UPDATE queue_tasks SET batch_id=? WHERE id=?')
    .run(batchId, take!.id);
  const input = {
    reviewHash: before.reviewHash,
    preparationHash: before.preparationHash!,
    note: 'Encerrar após revisão.',
  };
  assert.throws(() => closure.close(order.number, commandId, input), /mudou/);
  const pending = recovery.review(order.number, commandId);
  assert.equal(pending.canClose, false);
  assert.throws(
    () =>
      closure.close(order.number, commandId, {
        ...input,
        reviewHash: pending.reviewHash,
      }),
    /pendentes/,
  );
  queue.control(before.clientId, true);
  const claimed = queue.claim(take!.id, randomUUID())!;
  mutations.interrupt(claimed.connectionId!, 'server-restart');
  const uncertain = recovery.review(order.number, commandId);
  assert.equal(uncertain.canClose, false);
  assert.throws(
    () =>
      closure.close(order.number, commandId, {
        ...input,
        reviewHash: uncertain.reviewHash,
      }),
    /incerto/,
  );
  assert.equal(
    f.database.prepare('SELECT COUNT(*) AS count FROM dispatch_closures').get()!
      .count,
    0,
  );
  assert.equal(database.task(take!.id).summary.state, 'uncertain');
});

test('fully confirmed completed takes remain completed after a blocked dispatch is administratively closed', async (t) => {
  const { f, repository, recovery, order, commandId, batchId } =
    await blockedFixture(t);
  const clientId = recovery.review(order.number, commandId).clientId;
  const database = new QueueDatabase(f.database),
    queue = new QueueRepository(database),
    mutations = new QueueMutations(database);
  const takes = queue.enqueue(clientId, randomUUID(), [
    taskInput(),
    taskInput(),
    taskInput(),
  ]);
  queue.control(clientId, true);
  for (const take of takes) {
    f.database
      .prepare('UPDATE queue_tasks SET batch_id=? WHERE id=?')
      .run(batchId, take.id);
    const connectionId = randomUUID();
    const claimed = queue.claim(take.id, connectionId)!;
    for (const state of [
      'submitted',
      'generating',
      'download_pending',
      'completed',
    ] as const)
      mutations.progress(
        clientId,
        connectionId,
        progress(take.id, claimed.activeAttemptId!, state),
      );
  }
  const review = recovery.review(order.number, commandId);
  const closed = new DispatchClosure(
    repository,
    new ClientStore(f.database),
  ).close(order.number, commandId, {
    reviewHash: review.reviewHash,
    preparationHash: review.preparationHash!,
    note: 'Todos os takes simulados foram conferidos; encerrar o bloqueio administrativo.',
  });
  assert.equal(closed.state, 'completed');
  assert.equal(closed.counts.completed, 3);
});

test('project creation in progress cannot be closed; abandoning an uncertain creation preserves that uncertainty', async (t) => {
  const { f, repository, recovery, order, commandId, batchId } =
    await blockedFixture(t);
  const closure = new DispatchClosure(repository, new ClientStore(f.database));
  f.database
    .prepare("UPDATE flow_batches SET status='creating' WHERE id=?")
    .run(batchId);
  const creating = recovery.review(order.number, commandId);
  assert.equal(creating.canClose, false);
  assert.throws(
    () =>
      closure.close(order.number, commandId, {
        reviewHash: creating.reviewHash,
        preparationHash: creating.preparationHash!,
        note: 'Encerrar.',
      }),
    /andamento/,
  );
  f.database
    .prepare("UPDATE flow_batches SET status='uncertain' WHERE id=?")
    .run(batchId);
  const uncertain = recovery.review(order.number, commandId);
  assert.equal(uncertain.canResume, false);
  assert.equal(uncertain.canClose, true);
  closure.close(order.number, commandId, {
    reviewHash: uncertain.reviewHash,
    preparationHash: uncertain.preparationHash!,
    note: 'Conferi o Flow. Abandonar o grupo sem afirmar que o projeto não foi criado.',
  });
  assert.equal(
    f.database
      .prepare('SELECT status FROM flow_batches WHERE id=?')
      .get(batchId)!.status,
    'uncertain',
  );
  assert.equal(
    f.database.prepare('SELECT COUNT(*) AS count FROM queue_tasks').get()!
      .count,
    0,
  );
});
