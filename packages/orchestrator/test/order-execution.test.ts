import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import type { LightMyRequestResponse } from 'fastify';
import { fixture, management, pair, approve } from './support.js';
import { draft, image, publication } from './orders-support.js';
import { MaterialFiles } from '../src/orders/material-files.js';
import { OrderRepository } from '../src/orders/repository.js';
import { dispatchOrder } from '../src/orders/dispatch.js';
import { ClientStore } from '../src/persistence/clients.js';

test('publish and execute require consent and an authorized extension, then dispatch once without a hash', async (t) => {
  const f = await fixture(t),
    headers = await management(f);
  const repository = new OrderRepository(f.database);
  const files = new MaterialFiles(
    f.config.materialsDirectory,
    repository.materials,
  );
  const material = await files.import(Readable.from(image), 'reference.png');
  const order = repository.create(draft(material.id));
  const lease = repository.claim(order.id, 'fixture');
  const preparation = await publication(order, lease.leaseId);
  const receipt = await pair(f);
  const publish = (execution: object): Promise<LightMyRequestResponse> =>
    f.app.inject({
      method: 'POST',
      url: `/manage/orders/${order.id}/prepare`,
      headers,
      payload: { ...preparation, execution },
    });
  assert.equal((await publish({ clientId: receipt.clientId })).statusCode, 400);
  assert.equal(
    (await publish({ clientId: receipt.clientId, userAuthorized: false }))
      .statusCode,
    400,
  );
  assert.equal(
    (await publish({ clientId: receipt.clientId, userAuthorized: true }))
      .statusCode,
    401,
  );
  assert.equal(repository.get(order.id).state, 'preparing');
  await approve(f, receipt);
  const execution = { clientId: receipt.clientId, userAuthorized: true };
  const response = await publish(execution);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().state, 'dispatched');
  const first = repository.get(order.id);
  assert.ok(first.dispatches.length > 0);
  const replay = await publish(execution);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json().dispatches, first.dispatches);
  new ClientStore(f.database).revoke(receipt.clientId);
  assert.equal((await publish(execution)).statusCode, 403);
  assert.deepEqual(repository.get(order.id).dispatches, first.dispatches);
});

test('a concurrent preparation change cannot dispatch the earlier content without a hash', async (t) => {
  const f = await fixture(t),
    repository = new OrderRepository(f.database);
  const files = new MaterialFiles(
    f.config.materialsDirectory,
    repository.materials,
  );
  const material = await files.import(Readable.from(image), 'reference.png');
  const input = draft(material.id);
  input.products = [input.products[1]!];
  const order = repository.create(input);
  const lease = repository.claim(order.id, 'first');
  const preparation = await publication(order, lease.leaseId);
  const { prepareOrder } = await import('../src/orders/preparation.js');
  const { instructions } = await import('./instruction-fixture.js');
  const compiled = await prepareOrder(
    order,
    preparation,
    instructions.animationTemplates,
  );
  repository.publish(order.id, lease.leaseId, compiled);
  const receipt = await pair(f);
  await approve(f, receipt);
  const pending = dispatchOrder(repository, order.id, receipt.clientId);
  const rejected = assert.rejects(pending, /Pedido já alterado/);
  const revision = repository.claim(order.id, 'other', true);
  const changed = structuredClone(compiled);
  changed.products[0]!.variations[0]!.copy.hook = 'Different preparation.';
  repository.publish(order.id, revision.leaseId, changed);
  await rejected;
  assert.equal(repository.get(order.id).state, 'prepared');
  assert.deepEqual(repository.get(order.id).dispatches, []);
});

test('revocation during command preparation is checked before persisting any dispatch', async (t) => {
  const f = await fixture(t),
    repository = new OrderRepository(f.database);
  const files = new MaterialFiles(
    f.config.materialsDirectory,
    repository.materials,
  );
  const material = await files.import(Readable.from(image), 'reference.png');
  const order = repository.create(draft(material.id));
  const lease = repository.claim(order.id, 'fixture');
  const headers = await management(f);
  const published = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers,
    payload: await publication(order, lease.leaseId),
  });
  assert.equal(published.statusCode, 200, published.body);
  const receipt = await pair(f);
  await approve(f, receipt);
  const clients = new ClientStore(f.database);
  const pending = dispatchOrder(repository, order.id, receipt.clientId, () => {
    clients.authorized(receipt.clientId, f.extensionId);
  });
  const rejected = assert.rejects(pending, /Revoked/);
  clients.revoke(receipt.clientId);
  await rejected;
  assert.deepEqual(repository.get(order.id).dispatches, []);
});
