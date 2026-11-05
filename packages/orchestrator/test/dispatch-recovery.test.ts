import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { fixture, pair, approve } from './support.js';
import { draft, image, publication } from './orders-support.js';
import { OrderRepository } from '../src/orders/repository.js';
import { MaterialFiles } from '../src/orders/material-files.js';
import { dispatchOrder } from '../src/orders/dispatch.js';
import { DispatchStore } from '../src/persistence/dispatch.js';
import { BatchStore } from '../src/persistence/batches.js';
import { ClientStore } from '../src/persistence/clients.js';
import { DispatchRecovery } from '../src/orders/dispatch-recovery.js';
import { dispatchCommandSchema } from '@flow-batch/protocol';

async function blockedFixture(t: Parameters<typeof fixture>[0]): Promise<{
  f: Awaited<ReturnType<typeof fixture>>;
  repository: OrderRepository;
  recovery: DispatchRecovery;
  order: ReturnType<OrderRepository['get']>;
  commandId: string;
  batchId: string;
  headers: Record<string, string>;
}> {
  const f = await fixture(t),
    receipt = await pair(f),
    headers = await approve(f, receipt);
  const repository = new OrderRepository(f.database),
    files = new MaterialFiles(
      f.config.materialsDirectory,
      repository.materials,
    );
  const material = await files.import(Readable.from(image), 'produto.png'),
    input = draft(material.id);
  input.products = [input.products[1]!];
  input.products[0]!.groups[0]!.count = 1;
  const order = repository.create(input),
    lease = repository.claim(order.id, 'fixture');
  const response = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers,
    payload: await publication(order, lease.leaseId),
  });
  assert.equal(response.statusCode, 200, response.body);
  await dispatchOrder(
    repository,
    order.id,
    repository.get(order.id).preparationHash!,
    receipt.clientId,
  );
  const row = f.database
    .prepare(
      'SELECT dispatch_id,batch_id FROM order_dispatches WHERE order_id=?',
    )
    .get(order.id)!;
  const commandId = String(row.dispatch_id),
    batchId = String(row.batch_id),
    batches = new BatchStore(f.database);
  batches.action(receipt.clientId, {
    action: 'prepare',
    draft: { id: batchId, name: 'Fixture', mode: 'new-project' },
  });
  const claimed = batches.action(receipt.clientId, {
    action: 'claim',
    id: batchId,
    expectedRevision: 0,
  });
  batches.action(receipt.clientId, {
    action: 'settle',
    id: batchId,
    attemptId: claimed.attemptId!,
    outcome: 'not-created',
  });
  new DispatchStore(f.database).update(
    receipt.clientId,
    commandId,
    'blocked',
    'O projeto não foi criado. Confira o acesso ao Flow e solicite revisão do pedido pelo chat.',
  );
  return {
    f,
    repository,
    recovery: new DispatchRecovery(repository, new ClientStore(f.database)),
    order,
    commandId,
    batchId,
    headers,
  };
}

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
