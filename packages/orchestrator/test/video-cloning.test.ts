import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { LightMyRequestResponse } from 'fastify';
import { Readable } from 'node:stream';
import {
  MATERIAL_LIMIT,
  type OrderDraft,
  type Material,
} from '@flow-batch/protocol';
import { fixture, management, pair, approve } from './support.js';
import { image, publication } from './orders-support.js';
import {
  OrderRepository,
  type ProductionOrder,
} from '../src/orders/repository.js';
import { MaterialFiles } from '../src/orders/material-files.js';
import { variationPlan } from '../src/orders/preparation.js';

const mp4 = Buffer.from(
  '000000206674797069736f6d0000020069736f6d69736f32617663316d703431',
  'hex',
);
function cloneDraft(imageId: string, videoId: string): OrderDraft {
  return {
    id: randomUUID(),
    name: 'Clonagem fixture',
    products: [
      {
        id: randomUUID(),
        name: 'Produto',
        information: 'Fatos confirmados.',
        materials: [imageId, videoId],
        referenceId: imageId,
        groups: [
          {
            id: randomUUID(),
            format: 'clone',
            count: 1,
            videoReferenceId: videoId,
          },
        ],
      },
    ],
  };
}

test('video imports deduplicate, bind to the product, survive SQLite reopening and produce only image generation references', async (t) => {
  const f = await fixture(t),
    receipt = await pair(f),
    headers = await approve(f, receipt);
  const repository = new OrderRepository(f.database);
  const files = new MaterialFiles(
    f.config.materialsDirectory,
    repository.materials,
  );
  const photo = await files.import(Readable.from(image), 'produto.png');
  const clip = await files.import(Readable.from(mp4), 'referencia.mp4');
  assert.equal(clip.mime, 'video/mp4');
  assert.equal(
    (await files.import(Readable.from(mp4), 'outro.mp4')).id,
    clip.id,
  );
  assert.deepEqual((await files.verifiedBytes(clip.id)).bytes, mp4);
  const input = cloneDraft(photo.id, clip.id);
  const wrong = structuredClone(input);
  wrong.products[0]!.groups[0]!.videoReferenceId = photo.id;
  assert.throws(() => repository.create(wrong), /vídeo MP4/);
  const foreign = structuredClone(input);
  foreign.products[0]!.materials = [photo.id];
  assert.throws(() => repository.create(foreign), /materiais deste produto/);
  const order = repository.create(input);
  const reopened = new DatabaseSync(f.config.databasePath);
  assert.deepEqual(
    new OrderRepository(reopened).get(order.number).products,
    input.products,
  );
  reopened.close();
  assert.equal((await variationPlan(order))[0]!.videoReferenceId, clip.id);
  const { leaseId } = repository.claim(order.id, 'agente-fixture');
  const prepared = await publication(order, leaseId);
  prepared.products[0]!.variations[0]!.cloneVideo = {
    materialId: clip.id,
    analysis: 'Referência observada: descoberta, demonstração e CTA.',
    directions: {
      hook: 'Show only the hands.',
      body: 'Keep the product on the counter.',
      cta: 'Keep the same initial frame and show the product.',
    },
  };
  const swapped = structuredClone(prepared);
  swapped.products[0]!.variations[0]!.cloneVideo!.materialId = photo.id;
  const rejected = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers,
    payload: swapped,
  });
  assert.equal(rejected.statusCode, 400, rejected.body);
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
    result.preparation!.products[0]!.variations[0]!.cloneVideo!.materialId,
    clip.id,
  );
  assert.equal(
    f.database.prepare('SELECT count(*) AS n FROM dispatch_commands').get()!.n,
    0,
  );
  const dispatched = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/approve`,
    headers,
    payload: {
      approve: true,
      clientId: receipt.clientId,
      preparationHash: result.preparationHash,
    },
  });
  assert.equal(dispatched.statusCode, 200, dispatched.body);
  const command = JSON.parse(
    String(
      f.database.prepare('SELECT body FROM dispatch_commands').get()!.body,
    ),
  );
  assert.deepEqual(
    command.references.map((reference: { path: string }) => reference.path),
    [`${photo.id}.png`],
  );
  assert.equal(command.authorization.imageGenerations, 2);
  assert.equal(command.authorization.videoGenerations, 3);
  assert.equal(
    command.manifest.tasks[2].reuseImageFrom,
    command.manifest.tasks[1].id,
  );
  assert.equal((await files.cleanup([clip.id])).removed, 0);
  assert.equal(
    (
      await f.app.inject({
        url: `/manage/materials/${clip.id}`,
        headers: { host: f.headers.host },
      })
    ).statusCode,
    403,
  );
});

test('HTTP video imports allow more than 8 MB but reject fake MP4 and oversized images even with a video filename', async (t) => {
  const f = await fixture(t),
    headers = await management(f);
  const largeVideo = Buffer.concat([mp4, Buffer.alloc(MATERIAL_LIMIT)]);
  const upload = (
    name: string,
    bytes: Buffer,
  ): Promise<LightMyRequestResponse> =>
    f.app.inject({
      method: 'POST',
      url: '/manage/materials',
      headers: {
        ...headers,
        'content-type': 'application/octet-stream',
        'x-flow-filename': name,
      },
      payload: bytes,
    });
  const saved = await upload('referencia.mp4', largeVideo);
  assert.equal(saved.statusCode, 200, saved.body);
  const material = saved.json() as Material;
  assert.equal(material.mime, 'video/mp4');
  assert.equal(material.size, largeVideo.length);
  const read = await f.app.inject({
    url: `/manage/materials/${material.id}`,
    headers,
  });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.rawPayload, largeVideo);
  assert.equal(
    (await upload('falso.mp4', Buffer.from('not a video'))).statusCode,
    400,
  );
  const disguisedImage = Buffer.concat([image, Buffer.alloc(MATERIAL_LIMIT)]);
  assert.equal((await upload('imagem.mp4', disguisedImage)).statusCode, 413);
});

test('a video shared across orders remains protected until both orders are cancelled', async (t) => {
  const f = await fixture(t),
    repository = new OrderRepository(f.database);
  const files = new MaterialFiles(
    f.config.materialsDirectory,
    repository.materials,
  );
  const photo = await files.import(Readable.from(image), 'produto.png');
  const clip = await files.import(Readable.from(mp4), 'referencia.mp4');
  const first = repository.create(cloneDraft(photo.id, clip.id));
  const second = repository.create(cloneDraft(photo.id, clip.id));
  repository.cancel(first.id);
  assert.equal((await files.cleanup([clip.id])).removed, 0);
  repository.cancel(second.id);
  assert.equal((await files.cleanup([clip.id])).removed, 1);
  assert.equal(
    repository
      .get(first.id)
      .materials.find((material) => material.id === clip.id)!.available,
    false,
  );
  assert.equal(
    (await files.import(Readable.from(mp4), 'referencia.mp4')).id,
    clip.id,
  );
});
