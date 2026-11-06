import assert from 'node:assert/strict';
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

export async function blockedFixture(
  t: Parameters<typeof fixture>[0],
): Promise<{
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
  await dispatchOrder(repository, order.id, receipt.clientId);
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
    {
      stage: 'project-creation',
      code: 'project_wait_ready_failed',
      sent: false,
    },
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
