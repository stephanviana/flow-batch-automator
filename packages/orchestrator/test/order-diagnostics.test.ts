import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { fixture, management } from './support.js';
import { draft, image } from './orders-support.js';
import { OrderRepository } from '../src/orders/repository.js';
import { MaterialFiles } from '../src/orders/material-files.js';
import { ClientStore } from '../src/persistence/clients.js';
import { orderDiagnostic } from '../src/orders/diagnostics.js';

test('preparation diagnosis distinguishes no publication, active reservation, expired reservation and missing materials', async (t) => {
  const f = await fixture(t);
  const repository = new OrderRepository(f.database);
  const files = new MaterialFiles(
    f.config.materialsDirectory,
    repository.materials,
  );
  const material = await files.import(Readable.from(image), 'produto.png');
  const order = repository.create(draft(material.id));
  const clients = new ClientStore(f.database);
  const initial = orderDiagnostic(repository, clients, order.number);
  assert.equal(initial.preparation.published, false);
  assert.match(initial.preparation.message, /Nenhuma preparação foi publicada/);
  assert.deepEqual(initial.dispatches, []);
  repository.claim(order.id, 'fixture-agent');
  assert.match(
    orderDiagnostic(repository, clients, order.number).preparation.message,
    /fixture-agent/,
  );
  f.database
    .prepare('UPDATE production_orders SET lease_expires_at=1 WHERE id=?')
    .run(order.id);
  assert.match(
    orderDiagnostic(repository, clients, order.number).preparation.message,
    /expirou sem publicação/,
  );
  f.database
    .prepare("UPDATE materials SET state='deleted' WHERE id=?")
    .run(material.id);
  const headers = await management(f);
  const response = await f.app.inject({
    url: `/manage/orders/${order.number}/diagnostics`,
    headers,
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().unavailableMaterials, ['produto.png']);
});
