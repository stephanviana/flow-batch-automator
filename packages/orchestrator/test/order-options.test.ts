import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  preparationFormatSchema,
  type OrderDraft,
  dispatchCommandSchema,
} from '@flow-batch/protocol';
import { fixture, pair, approve, type Fixture } from './support.js';
import { draft, image, publication } from './orders-support.js';
import {
  OrderRepository,
  type ProductionOrder,
} from '../src/orders/repository.js';
import { MaterialFiles } from '../src/orders/material-files.js';
import { checkout } from '../src/agent-client/workspace.js';
import type { AgentApi } from '../src/agent-client/http.js';

function client(f: Fixture, headers: Record<string, string>): AgentApi {
  return (async (
    path: string,
    body?: unknown,
    binary = false,
  ): Promise<unknown> => {
    const response = await f.app.inject({
      method: body ? 'POST' : 'GET',
      url: path,
      headers,
      ...(body ? { payload: body } : {}),
    });
    assert.equal(response.statusCode, 200, response.body);
    return binary ? response.rawPayload : response.json();
  }) as AgentApi;
}
async function allFormats(f: Fixture): Promise<OrderDraft> {
  const files = new MaterialFiles(
    f.config.materialsDirectory,
    new OrderRepository(f.database).materials,
  );
  const photo = await files.import(Readable.from(image), 'product.png');
  const clip = await files.import(
    Readable.from(
      Buffer.from(
        '000000206674797069736f6d0000020069736f6d69736f32617663316d703431',
        'hex',
      ),
    ),
    'reference.mp4',
  );
  const input = draft(photo.id);
  input.products = [input.products[0]!];
  input.products[0]!.materials.push(clip.id);
  input.products[0]!.groups = preparationFormatSchema.options.map((format) => ({
    id: crypto.randomUUID(),
    format,
    count: 1,
    ...(format === 'clone' ? { videoReferenceId: clip.id } : {}),
  }));
  return input;
}
for (const videoModel of [
  undefined,
  'abra_i2v_8s',
  'veo_3_1_i2v_lite',
] as const)
  test(`order model ${videoModel ?? 'legacy'} reaches every format and dispatch without rewriting stored input`, async (t) => {
    const f = await fixture(t);
    const receipt = await pair(f);
    const api = client(f, await approve(f, receipt));
    const input = await allFormats(f);
    if (videoModel) input.videoModel = videoModel;
    const repository = new OrderRepository(f.database);
    repository.create(input);
    const original = f.database
      .prepare('SELECT body,body_hash FROM production_orders WHERE id=?')
      .get(input.id);
    const reserved = await checkout(
      api,
      1,
      'fixture',
      join(f.config.materialsDirectory, 'checkout'),
    );
    assert.equal(reserved.order.videoModel, videoModel);
    assert.equal(
      Object.hasOwn(reserved.order, 'videoModel'),
      videoModel !== undefined,
    );
    const body = await publication(reserved.order, reserved.leaseId);
    const planned = reserved.order.products[0]!.groups.find(
      (group) => group.format === 'clone',
    )!;
    for (const variation of body.products[0]!.variations)
      if (variation.format === 'clone')
        variation.cloneVideo = {
          materialId: planned.videoReferenceId!,
          analysis: 'Synthetic analysis.',
          directions: {
            hook: 'Show hands.',
            body: 'Show product.',
            cta: 'Keep scene.',
          },
        };
    const prepared = await api<ProductionOrder>(
      `/manage/orders/${input.id}/prepare`,
      body,
    );
    const takes = prepared.preparation!.manifests.flatMap(
      (manifest) => manifest.tasks,
    );
    assert.equal(takes.length, 24);
    for (const take of takes) {
      assert.equal(take.videoModel, videoModel ?? 'abra_i2v_8s');
      assert.equal(take.imageModel, 'GEM_PIX_2');
    }
    assert.equal(
      f.database.prepare('SELECT COUNT(*) AS n FROM dispatch_commands').get()!
        .n,
      0,
    );
    await api(`/manage/orders/${input.id}/approve`, {
      approve: true,
      clientId: receipt.clientId,
    });
    for (const row of f.database
      .prepare('SELECT body FROM dispatch_commands')
      .all())
      for (const take of dispatchCommandSchema.parse(
        JSON.parse(String(row.body)),
      ).manifest.tasks)
        assert.equal(take.videoModel, videoModel ?? 'abra_i2v_8s');
    assert.deepEqual(
      f.database
        .prepare('SELECT body,body_hash FROM production_orders WHERE id=?')
        .get(input.id),
      original,
    );
    const reopened = new DatabaseSync(f.config.databasePath);
    try {
      assert.deepEqual(
        new OrderRepository(reopened).get(input.id).preparation,
        prepared.preparation,
      );
    } finally {
      reopened.close();
    }
    assert.equal(repository.create(input).id, input.id);
    assert.throws(
      () =>
        repository.create({
          ...input,
          videoModel:
            videoModel === 'veo_3_1_i2v_lite'
              ? 'abra_i2v_8s'
              : 'veo_3_1_i2v_lite',
        }),
      /outras configurações/,
    );
    for (const invalid of [
      null,
      'abra_i2v_4s',
      'veo_3_1_i2v_lite_low_priority',
      'unknown',
    ])
      assert.throws(() =>
        repository.create({
          ...input,
          id: crypto.randomUUID(),
          videoModel: invalid,
        }),
      );
  });

test('preserved clone transcripts remain identical across takes and variations and cannot replace the selected mode', async (t) => {
  const f = await fixture(t);
  const receipt = await pair(f);
  const headers = await approve(f, receipt);
  const api = client(f, headers);
  const input = await allFormats(f);
  const group = input.products[0]!.groups.find(
    (group) => group.format === 'clone',
  )!;
  group.cloneMode = 'preserve-copy';
  group.count = 2;
  input.products[0]!.groups = [group];
  const repository = new OrderRepository(f.database);
  repository.create(input);
  const reserved = await checkout(
    api,
    1,
    'fixture',
    join(f.config.materialsDirectory, 'checkout'),
  );
  const skeleton = JSON.parse(
    await readFile(
      join(f.config.materialsDirectory, 'checkout', 'preparacao.json'),
      'utf8',
    ),
  ) as {
    products: {
      variations: { cloneVideo: { mode: string; transcript: object } }[];
    }[];
  };
  assert.equal(
    skeleton.products[0]!.variations[0]!.cloneVideo.mode,
    'preserve-copy',
  );
  assert.deepEqual(skeleton.products[0]!.variations[0]!.cloneVideo.transcript, {
    hook: '',
    body: '',
    cta: '',
  });
  const body = await publication(reserved.order, reserved.leaseId);
  const transcript = {
    hook: 'Fala $& e $$ original.',
    body: 'Texto e espaços  exatos.',
    cta: 'Confira a oferta.',
  };
  for (const variation of body.products[0]!.variations) {
    variation.copy = { ...transcript };
    variation.cloneVideo = {
      materialId: group.videoReferenceId!,
      mode: 'preserve-copy',
      transcript: { ...transcript },
      analysis: 'Verified synthetic transcript.',
      directions: {
        hook: 'Change avatar.',
        body: 'Change scene.',
        cta: 'Keep scene.',
      },
    };
  }
  const missing = structuredClone(body);
  delete missing.products[0]!.variations[0]!.cloneVideo!.transcript;
  const swapped = structuredClone(body);
  swapped.products[0]!.variations[0]!.cloneVideo!.mode = 'adapt-format';
  delete swapped.products[0]!.variations[0]!.cloneVideo!.transcript;
  const whitespace = structuredClone(body);
  whitespace.products[0]!.variations[0]!.copy.hook += ' ';
  const divergent = structuredClone(body);
  divergent.products[0]!.variations[1]!.copy.hook = 'Another original';
  divergent.products[0]!.variations[1]!.cloneVideo!.transcript!.hook =
    'Another original';
  for (const rejected of [missing, swapped, whitespace, divergent]) {
    const response = await f.app.inject({
      method: 'POST',
      url: `/manage/orders/${input.id}/prepare`,
      headers,
      payload: rejected,
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(repository.get(input.id).preparation, null);
  }
  const prepared = await api<ProductionOrder>(
    `/manage/orders/${input.id}/prepare`,
    body,
  );
  for (const manifest of prepared.preparation!.manifests)
    for (const take of manifest.tasks) {
      assert.ok(take.original.videoPrompt.includes(take.original.copy));
      assert.ok(Object.values(transcript).includes(take.original.copy));
    }
});
