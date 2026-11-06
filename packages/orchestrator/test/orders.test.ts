import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fixture, management, pair, approve, signed } from './support.js';
import {
  OrderRepository,
  type ProductionOrder,
} from '../src/orders/repository.js';
import { MaterialStore } from '../src/orders/material-store.js';
import { MaterialFiles } from '../src/orders/material-files.js';
import { Readable } from 'node:stream';
import { image, draft, publication } from './orders-support.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('panel imports, deduplicates and persists products; preparation reserves exact mixed formats without authorizing generation', async (t) => {
  const f = await fixture(t),
    headers = await management(f);
  const upload = await f.app.inject({
    method: 'POST',
    url: '/manage/materials',
    headers: {
      ...headers,
      'content-type': 'application/octet-stream',
      'x-flow-filename': 'foto.png',
    },
    payload: image,
  });
  assert.equal(upload.statusCode, 200, upload.body);
  const material = upload.json();
  const again = await f.app.inject({
    method: 'POST',
    url: '/manage/materials',
    headers: {
      ...headers,
      'content-type': 'application/octet-stream',
      'x-flow-filename': 'outra.png',
    },
    payload: image,
  });
  assert.equal(again.json().id, material.id);
  const input = draft(material.id);
  const saved = await f.app.inject({
    method: 'POST',
    url: '/manage/orders',
    headers,
    payload: input,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const order = saved.json() as ProductionOrder;
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/manage/orders',
        headers,
        payload: input,
      })
    ).json().number,
    order.number,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/manage/orders',
        headers,
        payload: { ...input, name: 'changed' },
      })
    ).statusCode,
    409,
  );
  assert.equal((await f.app.inject({ url: '/manage/orders' })).statusCode, 403);
  const reserve = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/claim`,
    headers,
    payload: { worker: 'codex' },
  });
  assert.equal(reserve.statusCode, 200, reserve.body);
  const leaseId = String(reserve.json().leaseId);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `/manage/orders/${order.id}/claim`,
        headers,
        payload: { worker: 'antigravity' },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/manage/cleanup',
        headers,
        payload: { ids: [material.id] },
      })
    ).json().removed,
    0,
  );
  const prepared = await publication(order, leaseId),
    changed = structuredClone(prepared);
  changed.products[0]!.variations[0]!.format = 'seller';
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `/manage/orders/${order.id}/prepare`,
        headers,
        payload: changed,
      })
    ).statusCode,
    400,
  );
  const published = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers,
    payload: prepared,
  });
  assert.equal(published.statusCode, 200, published.body);
  const result = published.json() as ProductionOrder;
  assert.equal(result.state, 'prepared');
  assert.equal(
    result.preparation!.manifests.flatMap((manifest) => manifest.tasks).length,
    21,
  );
  assert.equal(
    f.database.prepare('SELECT COUNT(*) AS n FROM queue_tasks').get()?.n,
    0,
  );
  assert.equal(
    f.database.prepare('SELECT COUNT(*) AS n FROM dispatch_commands').get()?.n,
    0,
  );
  for (const manifest of result.preparation!.manifests) {
    assert.ok(manifest.tasks.length <= 18);
    for (const take of manifest.tasks.filter((take) => take.reuseImageFrom))
      assert.ok(
        manifest.tasks.some((source) => source.id === take.reuseImageFrom),
      );
  }
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `/manage/orders/${order.id}/prepare`,
        headers,
        payload: prepared,
      })
    ).json().preparationHash,
    result.preparationHash,
  );
  const reopened = new DatabaseSync(f.config.databasePath);
  assert.equal(
    new OrderRepository(reopened).get(order.number).preparationHash,
    result.preparationHash,
  );
  reopened.close();
});

test('only approved owner can fetch exact managed references; missing consent and changed bytes are refused', async (t) => {
  const f = await fixture(t),
    receipt = await pair(f),
    headers = await approve(f, receipt);
  const repository = new OrderRepository(f.database),
    files = new MaterialFiles(
      f.config.materialsDirectory,
      repository.materials,
    );
  const material = await files.import(Readable.from(image), 'foto.png');
  const order = repository.create(draft(material.id));
  const lease = repository.claim(order.id, 'test'),
    input = await publication(order, lease.leaseId);
  const prepared = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers,
    payload: input,
  });
  assert.equal(prepared.statusCode, 200, prepared.body);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `/manage/orders/${order.id}/approve`,
        headers,
        payload: {
          approve: false,
          clientId: receipt.clientId,
        },
      })
    ).statusCode,
    400,
  );
  const approved = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/approve`,
    headers,
    payload: {
      approve: true,
      clientId: receipt.clientId,
    },
  });
  assert.equal(approved.statusCode, 200, approved.body);
  const first = f.database
    .prepare('SELECT body FROM dispatch_commands ORDER BY rowid LIMIT 1')
    .get()!;
  const command = JSON.parse(String(first.body));
  assert.equal(command.source, 'managed');
  const body = JSON.stringify({
    dispatchId: command.id,
    path: command.references[0].path,
  });
  const proof = await signed(
    f,
    receipt.clientId,
    'POST',
    '/api/materials',
    body,
  );
  const download = await f.app.inject({
    method: 'POST',
    url: '/api/materials',
    headers: proof.headers,
    payload: body,
  });
  assert.equal(download.statusCode, 200, download.body);
  assert.equal(download.json().base64, image.toString('base64'));
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/materials',
        headers: proof.headers,
        payload: body,
      })
    ).statusCode,
    401,
  );
  const wrong = JSON.stringify({ dispatchId: command.id, path: 'other.png' }),
    wrongProof = await signed(
      f,
      receipt.clientId,
      'POST',
      '/api/materials',
      wrong,
    );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/materials',
        headers: wrongProof.headers,
        payload: wrong,
      })
    ).statusCode,
    403,
  );
  const before = f.database
    .prepare('SELECT COUNT(*) AS n FROM dispatch_commands')
    .get()?.n;
  await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/approve`,
    headers,
    payload: {
      approve: true,
      clientId: receipt.clientId,
    },
  });
  assert.equal(
    f.database.prepare('SELECT COUNT(*) AS n FROM dispatch_commands').get()?.n,
    before,
  );
  assert.equal(repository.materials.candidates().length, 0);
  assert.equal(repository.get(order.id).state, 'dispatched');
  const otherId = 'b'.repeat(32);
  const otherFixture = {
    ...f,
    extensionId: otherId,
    headers: { ...f.headers, 'x-flow-extension': otherId },
  };
  const other = await pair(otherFixture);
  await approve(otherFixture, other);
  const foreign = await signed(
    otherFixture,
    other.clientId,
    'POST',
    '/api/materials',
    body,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/materials',
        headers: foreign.headers,
        payload: body,
      })
    ).statusCode,
    404,
  );
  const changed = Buffer.from(image);
  changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
  await writeFile(join(f.config.materialsDirectory, material.sha256), changed);
  const tampered = await signed(
    f,
    receipt.clientId,
    'POST',
    '/api/materials',
    body,
  );
  const rejected = await f.app.inject({
    method: 'POST',
    url: '/api/materials',
    headers: tampered.headers,
    payload: body,
  });
  assert.equal(rejected.statusCode, 409);
  assert.equal(rejected.body.includes(f.config.materialsDirectory), false);
});

test('cleanup protects shared active materials, retains history, and permits reimport after removal', async (t) => {
  const f = await fixture(t),
    repository = new OrderRepository(f.database),
    files = new MaterialFiles(
      f.config.materialsDirectory,
      new MaterialStore(f.database),
    );
  const material = await files.import(Readable.from(image), 'foto.png');
  const first = repository.create(draft(material.id)),
    second = repository.create(draft(material.id));
  repository.cancel(first.id);
  assert.equal((await files.cleanup([material.id])).removed, 0);
  repository.cancel(second.id);
  assert.equal(repository.materials.candidates().length, 1);
  assert.equal((await files.cleanup([material.id])).removed, 1);
  await assert.rejects(files.read(material.id), /removido/);
  assert.equal(repository.get(first.number).state, 'cancelled');
  assert.equal(repository.get(first.number).materials[0]!.available, false);
  assert.equal((await files.cleanup([material.id])).removed, 0);
  const restored = await files.import(Readable.from(image), 'foto.png');
  assert.equal(restored.id, material.id);
  assert.equal(restored.available, true);
  assert.deepEqual((await files.verifiedBytes(material.id)).bytes, image);
});

test('upload limits, hostile names and foreign origins are rejected; expired claims cannot publish', async (t) => {
  const f = await fixture(t),
    headers = await management(f);
  for (const [name, payload] of [
    ['..%2Fsecret.png', image],
    ['bad.exe', Buffer.from('bad')],
  ] as const) {
    const response = await f.app.inject({
      method: 'POST',
      url: '/manage/materials',
      headers: {
        ...headers,
        'content-type': 'application/octet-stream',
        'x-flow-filename': name,
      },
      payload,
    });
    assert.equal(response.statusCode, 400, response.body);
  }
  const response = await f.app.inject({
    method: 'POST',
    url: '/manage/materials',
    headers: {
      ...headers,
      origin: 'https://example.com',
      'content-type': 'application/octet-stream',
      'x-flow-filename': 'photo.png',
    },
    payload: image,
  });
  assert.equal(response.statusCode, 403);
  const repository = new OrderRepository(f.database),
    files = new MaterialFiles(
      f.config.materialsDirectory,
      repository.materials,
    );
  const material = await files.import(Readable.from(image), 'foto.png'),
    order = repository.create(draft(material.id));
  const { leaseId } = repository.claim(order.id, 'first');
  f.database
    .prepare('UPDATE production_orders SET lease_expires_at=1 WHERE id=?')
    .run(order.id);
  assert.throws(() => repository.requireLease(order.id, leaseId), /expirada/);
  const next = repository.claim(order.id, 'second');
  assert.notEqual(next.leaseId, leaseId);
});
