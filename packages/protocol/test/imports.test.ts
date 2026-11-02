import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  importManifestSchema,
  popupRequestSchema,
  importImageCount,
  flowOutputSchema,
  flowOutputFileSchema,
} from '../src/index.js';

function manifest(): Record<string, unknown> {
  return {
    version: 1,
    id: randomUUID(),
    tasks: [
      {
        id: randomUUID(),
        product: 'Produto',
        video: 'Vídeo',
        take: 'Hook',
        reference: 'refs/produto.png',
        original: {
          imagePrompt: '  imagem\n',
          videoPrompt: '\nvídeo ',
          copy: ' Copy\n',
        },
      },
    ],
  };
}

test('import manifest defaults apply only to new takes and preserve original strings', () => {
  const parsed = importManifestSchema.parse(manifest());
  assert.deepEqual(parsed.tasks[0]?.original, {
    imagePrompt: '  imagem\n',
    videoPrompt: '\nvídeo ',
    copy: ' Copy\n',
  });
  assert.equal(parsed.tasks[0]?.imageModel, 'GEM_PIX_2');
  assert.equal(parsed.tasks[0]?.videoModel, 'abra_i2v_8s');
  assert.equal(parsed.tasks[0]?.aspect, '9:16');
});

test('import rejects unsafe paths, unsupported models, blank prompts and embedded approvals', () => {
  const parsed = importManifestSchema.parse(manifest());
  for (const reference of [
    '../ref.png',
    '/tmp/ref.png',
    'C:\\ref.png',
    'https://example.com/ref.png',
    'refs//ref.png',
  ]) {
    assert.equal(
      importManifestSchema.safeParse({
        ...parsed,
        tasks: [{ ...parsed.tasks[0], reference }],
      }).success,
      false,
    );
  }
  for (const patch of [
    { approval: true },
    { videoModel: 'arbitrary' },
    { original: { imagePrompt: ' ', videoPrompt: 'video', copy: '' } },
  ]) {
    assert.equal(
      importManifestSchema.safeParse({
        ...parsed,
        tasks: [{ ...parsed.tasks[0], ...patch }],
      }).success,
      false,
    );
  }
});

test('import requires version, unique take IDs and one to twenty takes', () => {
  const parsed = importManifestSchema.parse(manifest());
  for (const tasks of [
    [],
    [parsed.tasks[0], parsed.tasks[0]],
    Array.from({ length: 21 }, () => ({
      ...parsed.tasks[0],
      id: randomUUID(),
    })),
  ]) {
    assert.equal(
      importManifestSchema.safeParse({ ...parsed, tasks }).success,
      false,
    );
  }
  assert.equal(
    importManifestSchema.safeParse({ ...parsed, version: 2 }).success,
    false,
  );
  assert.equal(
    popupRequestSchema.safeParse({ type: 'enqueue-import' }).success,
    false,
  );
});

test('CTA reuses only an earlier direct source with identical visual materials in its variation', () => {
  const parsed = importManifestSchema.parse(manifest());
  const body = {
    ...parsed.tasks[0]!,
    take: 'Body',
    output: { groupId: randomUUID(), filename: '02-Body.mp4' },
  };
  const cta = {
    ...body,
    id: randomUUID(),
    take: 'CTA',
    reuseImageFrom: body.id,
    output: { ...body.output, filename: '03-CTA.mp4' },
  };
  const valid = { ...parsed, tasks: [body, cta] };
  assert.equal(importImageCount(importManifestSchema.parse(valid)), 1);
  for (const patch of [
    { reuseImageFrom: randomUUID() },
    { reuseImageFrom: cta.id },
    { product: 'Outro' },
    { video: 'Outra variação' },
    { reference: 'outra.png' },
    { imageModel: 'BELUGA' },
    { aspect: '16:9' },
    { original: { ...cta.original, imagePrompt: 'Outra pessoa' } },
    { output: { ...cta.output, groupId: randomUUID() } },
    { output: { ...cta.output, filename: '02-bODY.mp4' } },
  ])
    assert.equal(
      importManifestSchema.safeParse({
        ...valid,
        tasks: [body, { ...cta, ...patch }],
      }).success,
      false,
    );
  assert.equal(
    importManifestSchema.safeParse({ ...valid, tasks: [cta, body] }).success,
    false,
  );
  assert.equal(
    importManifestSchema.safeParse({
      ...valid,
      tasks: [
        body,
        cta,
        {
          ...cta,
          id: randomUUID(),
          reuseImageFrom: cta.id,
          output: { ...cta.output, filename: '04-CTA.mp4' },
        },
      ],
    }).success,
    false,
  );
});

test('grouped outputs allow portable relative folders and reject traversal and Windows reserved names', () => {
  const output = { directory: 'lote-123/variacao-456', filename: '03-CTA.mp4' };
  assert.deepEqual(flowOutputSchema.parse(output), output);
  assert.equal(
    flowOutputFileSchema.safeParse('FlowBatch/lote-123/variacao-456/03-CTA.mp4')
      .success,
    true,
  );
  assert.equal(
    flowOutputFileSchema.safeParse(`FlowBatch/${randomUUID()}/take.mp4`)
      .success,
    true,
  );
  for (const directory of [
    '../fora',
    '/tmp',
    'C:/temp',
    'lote/../fora',
    'lote/CON',
    'aux',
    'pasta\\outra',
    'a/b/c',
  ])
    assert.equal(
      flowOutputSchema.safeParse({ ...output, directory }).success,
      false,
    );
  for (const filename of [
    '../take.mp4',
    'CON.mp4',
    'a.webm',
    'take?.mp4',
    'C:\\take.mp4',
  ])
    assert.equal(
      flowOutputSchema.safeParse({ ...output, filename }).success,
      false,
    );
});
