import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fixture, management } from './support.js';
import { draft, image } from './orders-support.js';
import { OrderRepository } from '../src/orders/repository.js';
import { MaterialFiles } from '../src/orders/material-files.js';
import { OrderVisibility } from '../src/orders/visibility.js';
import { blockedFixture } from './dispatch-recovery-support.js';
import { QueueDatabase } from '../src/queue/database.js';
import { QueueRepository } from '../src/queue/repository.js';
import { taskInput } from './queue-support.js';
import { flowInput } from './flow-support.js';
import { QueueMutations } from '../src/queue/mutations.js';
import { dispatchOrder } from '../src/orders/dispatch.js';

test('clearing safe orders persists, preserves materials and UUIDs, and resets numbers only once the current list is empty', async (t) => {
  const f = await fixture(t),
    headers = await management(f);
  const repository = new OrderRepository(f.database);
  const files = new MaterialFiles(
    f.config.materialsDirectory,
    repository.materials,
  );
  const material = await files.import(Readable.from(image), 'foto.png');
  const first = repository.create(draft(material.id)),
    second = repository.create(draft(material.id));
  const visibility = new OrderVisibility(repository);
  const lease = repository.claim(second.id, 'fixture');
  const url = '/manage/orders/clear';
  assert.equal(
    (await f.app.inject({ method: 'POST', url, payload: { ids: [first.id] } }))
      .statusCode,
    403,
  );
  assert.throws(() => visibility.clear([first.id, second.id]), /atenção/);
  assert.equal(
    repository.get(first.id).archivedAt,
    null,
    'Bulk clear must roll back on changed or active work',
  );
  assert.equal(
    repository.list().find((order) => order.id === first.id)!.clearable,
    true,
  );
  const response = await f.app.inject({
    method: 'POST',
    url,
    headers,
    payload: { ids: [first.id] },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { cleared: 1, nextNumber: 3 });
  const archived = repository.get(first.id);
  assert.ok(archived.archivedAt);
  assert.deepEqual({ ...archived, archivedAt: null }, first);
  assert.deepEqual(
    await files.verifiedBytes(material.id).then((value) => value.bytes),
    image,
  );
  assert.throws(() => repository.claim(first.id, 'fixture'), /removido/);
  assert.equal(repository.list().length, 1);
  f.database
    .prepare('UPDATE production_orders SET lease_expires_at=1 WHERE id=?')
    .run(second.id);
  repository.cancel(second.id);
  assert.deepEqual(visibility.clear([first.id, second.id]), {
    cleared: 1,
    nextNumber: 1,
  });
  assert.deepEqual(visibility.clear([first.id, second.id]), {
    cleared: 0,
    nextNumber: 1,
  });
  assert.throws(
    () => repository.requireLease(second.id, lease.leaseId),
    /expirada/,
  );
  const connection = new DatabaseSync(f.config.databasePath);
  try {
    const reopened = new OrderRepository(connection);
    assert.deepEqual(reopened.list(), []);
    const next = reopened.create(draft(material.id));
    assert.equal(next.number, 1);
    assert.equal(next.numberCycle, 1);
    assert.notEqual(next.id, first.id);
    assert.equal(reopened.get(1).id, next.id);
    assert.equal(reopened.get(first.id).id, first.id);
    assert.equal(
      (
        await f.app.inject({ url: `/manage/orders/id/${first.id}`, headers })
      ).json().order.id,
      first.id,
    );
    assert.throws(
      () =>
        reopened.publish(first.id, randomUUID(), {
          products: [],
          manifests: [],
        }),
      /removido/,
    );
    await assert.rejects(
      dispatchOrder(reopened, first.id, randomUUID(), () => {}),
      /removido/,
    );
  } finally {
    connection.close();
  }
});

test('blocked dispatches cannot be cleared; closing without a note enables clearing and also clears terminal takes without changing execution records', async (t) => {
  const { f, repository, recovery, order, commandId, batchId, headers } =
    await blockedFixture(t);
  const visibility = new OrderVisibility(repository);
  assert.equal(repository.list()[0]!.clearable, false);
  assert.throws(() => visibility.clear([order.id]), /atenção/);
  const review = recovery.review(order.number, commandId);
  const close = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.number}/dispatches/${commandId}/close`,
    headers,
    payload: {
      reviewHash: review.reviewHash,
      preparationHash: review.preparationHash,
    },
  });
  assert.equal(close.statusCode, 200, close.body);
  const queueDatabase = new QueueDatabase(f.database),
    queue = new QueueRepository(queueDatabase);
  const [task] = queue.enqueue(review.clientId, randomUUID(), [taskInput()]);
  f.database
    .prepare(
      "UPDATE queue_tasks SET state='failed',safe_to_retry=1,batch_id=? WHERE id=?",
    )
    .run(batchId, task!.id);
  const before = queueDatabase.detail(task!.id, review.clientId);
  const original = repository.get(order.id);
  assert.equal(repository.list()[0]!.clearable, true);
  visibility.clear([order.id]);
  assert.deepEqual(repository.get(order.id).preparation, original.preparation);
  assert.deepEqual(repository.get(order.id).dispatches, original.dispatches);
  assert.deepEqual(queueDatabase.detail(task!.id, review.clientId), before);
  assert.equal(queue.snapshot(review.clientId).tasks.length, 1);
  assert.equal(queue.snapshot(review.clientId, true).tasks.length, 0);
  assert.throws(
    () =>
      new QueueMutations(queueDatabase).action(review.clientId, {
        action: 'retry',
        requestId: randomUUID(),
        taskId: task!.id,
        expectedRevision: task!.revision,
        acknowledgeDuplicateRisk: false,
      }),
    /removido/,
  );
  const take = flowInput();
  take.flow.batchId = batchId;
  assert.throws(
    () => queue.enqueue(review.clientId, randomUUID(), [take]),
    /encerrado|removido/,
  );
});
