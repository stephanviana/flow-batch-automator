import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { preparationFormatSchema, type OrderDraft } from '@flow-batch/protocol';
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
