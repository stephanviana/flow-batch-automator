import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { dispatchCommandSchema } from '@flow-batch/protocol';
import { fixture, pair, approve } from './support.js';
import { draft, image, publication } from './orders-support.js';
import { OrderRepository } from '../src/orders/repository.js';
import { MaterialFiles } from '../src/orders/material-files.js';

test('mixed and full formats publish and authorize their exact image counts without changing sources', async (t) => {
  const f = await fixture(t),
    receipt = await pair(f);
  const headers = await approve(f, receipt);
  const repository = new OrderRepository(f.database);
  const files = new MaterialFiles(
    f.config.materialsDirectory,
    repository.materials,
  );
  const material = await files.import(Readable.from(image), 'fixture.png');
  const input = draft(material.id);
  input.products = [input.products[0]!];
  input.products[0]!.groups = (
    ['factory', 'pov', 'full-pov', 'seller'] as const
  ).map((format) => ({ id: randomUUID(), format, count: 1 }));
  const order = repository.create(input);
  const lease = repository.claim(order.id, 'fixture');
  const payload = await publication(order, lease.leaseId);
  const published = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers,
    payload,
  });
  assert.equal(published.statusCode, 200, published.body);
  const before = repository.get(order.id);
  assert.deepEqual(repository.list()[0]!.generationCounts, {
    images: 6,
    videos: 12,
  });
  assert.equal(
    f.database.prepare('SELECT count(*) AS n FROM dispatch_commands').get()?.n,
    0,
  );
  const response = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/approve`,
    headers,
    payload: {
      approve: true,
      clientId: receipt.clientId,
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  const commands = f.database
    .prepare('SELECT body FROM dispatch_commands')
    .all()
    .map((row) => dispatchCommandSchema.parse(JSON.parse(String(row.body))));
  assert.equal(
    commands.reduce(
      (sum, command) => sum + command.authorization.imageGenerations,
      0,
    ),
    6,
  );
  assert.equal(
    commands.reduce(
      (sum, command) => sum + command.authorization.videoGenerations,
      0,
    ),
    12,
  );
  for (const manifest of before.preparation!.manifests) {
    for (let index = 0; index < manifest.tasks.length; index += 3) {
      const [hook, body, cta] = manifest.tasks.slice(index, index + 3);
      assert.ok(hook && body && cta);
      const singleImage =
        hook.video.startsWith('full-pov') || hook.video.startsWith('seller');
      assert.equal(body.reuseImageFrom, singleImage ? hook.id : undefined);
      assert.equal(cta.reuseImageFrom, singleImage ? hook.id : body.id);
    }
  }
  assert.deepEqual(repository.get(order.id).preparation, before.preparation);
  assert.equal(
    repository.get(order.id).preparationHash,
    before.preparationHash,
  );
});

test('historical two-image seller manifests retain their recorded image count and hash', async (t) => {
  const f = await fixture(t);
  const repository = new OrderRepository(f.database);
  const files = new MaterialFiles(
    f.config.materialsDirectory,
    repository.materials,
  );
  const material = await files.import(Readable.from(image), 'fixture.png');
  const input = draft(material.id);
  input.products = [input.products[1]!];
  input.products[0]!.groups[0]!.count = 1;
  const order = repository.create(input);
  const lease = repository.claim(order.id, 'fixture');
  const preparation = await publication(order, lease.leaseId);
  const published = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers: await approve(f, await pair(f)),
    payload: preparation,
  });
  assert.equal(published.statusCode, 200, published.body);
  const historical = repository.get(order.id).preparation!;
  const [hook, body, cta] = historical.manifests[0]!.tasks;
  assert.ok(hook && body && cta);
  delete body.reuseImageFrom;
  cta.reuseImageFrom = body.id;
  const revision = repository.claim(order.id, 'fixture', true);
  const saved = repository.publish(order.id, revision.leaseId, historical);
  assert.deepEqual(repository.list()[0]!.generationCounts, {
    images: 2,
    videos: 3,
  });
  assert.equal(repository.get(order.id).preparationHash, saved.preparationHash);
  assert.deepEqual(
    repository.get(order.id).preparation!.manifests,
    historical.manifests,
  );
});
