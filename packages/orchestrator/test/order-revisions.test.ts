import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LightMyRequestResponse } from 'fastify';
import { Readable } from 'node:stream';
import { readdir } from 'node:fs/promises';
import { fixture, management } from './support.js';
import { image, draft, publication } from './orders-support.js';
import { OrderRepository } from '../src/orders/repository.js';
import { MaterialFiles } from '../src/orders/material-files.js';

test('explicit preparation revision fences the old hash, retains both versions and releases an unchanged revision', async (t) => {
  const f = await fixture(t),
    headers = await management(f),
    repository = new OrderRepository(f.database);
  const files = new MaterialFiles(
    f.config.materialsDirectory,
    repository.materials,
  );
  const material = await files.import(Readable.from(image), 'ref.png'),
    order = repository.create(draft(material.id));
  const lease = repository.claim(order.id, 'codex');
  const input = await publication(order, lease.leaseId);
  const publish = (body: unknown): Promise<LightMyRequestResponse> =>
    f.app.inject({
      method: 'POST',
      url: `/manage/orders/${order.id}/prepare`,
      headers,
      payload: body as object,
    });
  const first = await publish(input);
  assert.equal(first.statusCode, 200, first.body);
  assert.throws(
    () => repository.claim(order.id, 'antigravity'),
    /já preparado/,
  );
  const revised = repository.claim(order.id, 'codex', true);
  assert.equal(repository.get(order.id).state, 'preparing');
  input.leaseId = revised.leaseId;
  input.products[0]!.variations[0]!.copy.hook = 'Outra abertura de teste.';
  const second = await publish(input);
  assert.equal(second.statusCode, 200, second.body);
  assert.notEqual(second.json().preparationHash, first.json().preparationHash);
  assert.equal(
    f.database
      .prepare('SELECT COUNT(*) AS n FROM order_preparations WHERE order_id=?')
      .get(order.id)?.n,
    2,
  );
  const unchanged = repository.claim(order.id, 'codex', true);
  input.leaseId = unchanged.leaseId;
  const same = await publish(input);
  assert.equal(same.json().state, 'prepared');
  assert.equal(same.json().lease, null);
});

test('oversized streaming import is rejected without leaving a temporary copy', async (t) => {
  const f = await fixture(t),
    repository = new OrderRepository(f.database),
    files = new MaterialFiles(
      f.config.materialsDirectory,
      repository.materials,
    );
  await assert.rejects(
    files.import(Readable.from([image, Buffer.alloc(8_388_608)]), 'ref.png'),
    /até 8 MB/,
  );
  assert.deepEqual(await readdir(f.config.materialsDirectory), []);
});
