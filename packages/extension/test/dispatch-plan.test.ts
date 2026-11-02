import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  type Batch,
  type FlowReference,
  approvedImportSchema,
  importManifestSchema,
} from '@flow-batch/protocol';
import {
  referenceFiles,
  importTaskKey,
  buildImportPlan,
  approveImport,
  importFingerprint,
} from '../src/dispatch-plan.js';

function manifest(): ReturnType<typeof importManifestSchema.parse> {
  return importManifestSchema.parse({
    version: 1,
    id: randomUUID(),
    tasks: [
      {
        id: randomUUID(),
        product: 'Produto',
        video: 'Vídeo',
        take: 'Hook',
        reference: 'ref.png',
        original: {
          imagePrompt: '  imagem\n',
          videoPrompt: '\nvídeo ',
          copy: ' Copy\n',
        },
      },
    ],
  });
}
function batch(): Batch {
  return {
    id: randomUUID(),
    name: 'Lote',
    mode: 'existing-project',
    status: 'ready',
    projectId: randomUUID(),
    projectTitle: null,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}
function reference(assetId: string): FlowReference {
  return {
    assetId,
    name: 'ref.png',
    mime: 'image/png',
    bytes: 42,
    sha256: 'a'.repeat(64),
  };
}

test('file indexing rejects ambiguous reference names', () => {
  const file = new File(['fixture'], 'ref.png');
  assert.equal(referenceFiles([file]).get('ref.png'), file);
  assert.throws(() => referenceFiles([file, file]), /ambígua/);
});

test('keys and preview fingerprints are stable across reloads and scoped to batch', async () => {
  const parsed = manifest(),
    destination = batch();
  const key = await importTaskKey(
    destination.id,
    parsed.id,
    parsed.tasks[0]!.id,
  );
  assert.equal(
    await importTaskKey(destination.id, parsed.id, parsed.tasks[0]!.id),
    key,
  );
  assert.notEqual(
    await importTaskKey(randomUUID(), parsed.id, parsed.tasks[0]!.id),
    key,
  );
  const plan = buildImportPlan(parsed, destination, [reference(key)], [key]);
  const rebuilt = buildImportPlan(parsed, destination, [reference(key)], [key]);
  assert.equal(await importFingerprint(plan), await importFingerprint(rebuilt));
  const approved = approveImport(plan, 12345);
  assert.notEqual(approved.requestId, plan.requestId);
  const task = approved.tasks[0]!;
  assert.equal(task.executor, 'google-flow');
  if (task.executor !== 'google-flow') throw new Error('Expected Flow');
  assert.equal(task.flow.approval.approvedAt, 12345);
  assert.equal(task.flow.batchId, destination.id);
  assert.deepEqual(task.original, parsed.tasks[0]!.original);
  assert.equal(
    plan.tasks[0]?.executor === 'google-flow' &&
      plan.tasks[0].flow.approval.approvedAt,
    1,
  );
  assert.throws(
    () =>
      buildImportPlan(
        parsed,
        { ...destination, status: 'uncertain' },
        [reference(key)],
        [key],
      ),
    /Prepare/,
  );
});

test('aggregate UTF-8 payload limit is enforced before any enqueue and mixed projects are rejected', async () => {
  const parsed = manifest(),
    destination = batch();
  const key = await importTaskKey(
    destination.id,
    parsed.id,
    parsed.tasks[0]!.id,
  );
  const plan = buildImportPlan(parsed, destination, [reference(key)], [key]);
  const task = plan.tasks[0]!;
  if (task.executor !== 'google-flow') throw new Error('Expected Flow');
  assert.equal(
    approvedImportSchema.safeParse({
      ...plan,
      tasks: [
        task,
        {
          ...task,
          taskKey: randomUUID(),
          flow: { ...task.flow, projectId: randomUUID() },
        },
      ],
    }).success,
    false,
  );
  parsed.tasks = Array.from({ length: 10 }, () => ({
    ...parsed.tasks[0]!,
    id: randomUUID(),
    original: { imagePrompt: 'á'.repeat(4096), videoPrompt: 'vídeo', copy: '' },
  }));
  assert.throws(
    () =>
      buildImportPlan(
        parsed,
        destination,
        parsed.tasks.map(() => reference(randomUUID())),
        parsed.tasks.map(() => randomUUID()),
      ),
    /64 KiB/,
  );
});

test('reused CTA binds the Body task key, zero image budget and a shared output folder with distinct filenames', async () => {
  const parsed = manifest(),
    destination = batch();
  const body = {
    ...parsed.tasks[0]!,
    output: { groupId: randomUUID(), filename: '02-Body.mp4' },
  };
  parsed.tasks = [
    body,
    {
      ...body,
      id: randomUUID(),
      take: 'CTA',
      reuseImageFrom: body.id,
      output: { ...body.output, filename: '03-CTA.mp4' },
    },
  ];
  const keys = await Promise.all(
    parsed.tasks.map((take) =>
      importTaskKey(destination.id, parsed.id, take.id),
    ),
  );
  const plan = buildImportPlan(parsed, destination, keys.map(reference), keys);
  const [source, cta] = plan.tasks;
  assert.ok(
    source?.executor === 'google-flow' && cta?.executor === 'google-flow',
  );
  assert.equal(cta.flow.imageSourceTaskKey, source.taskKey);
  assert.equal(source.flow.approval.imageGenerations, 1);
  assert.equal(cta.flow.approval.imageGenerations, 0);
  assert.equal(source.flow.output?.directory, cta.flow.output?.directory);
  assert.equal(source.flow.output?.filename, '02-Body.mp4');
  assert.equal(cta.flow.output?.filename, '03-CTA.mp4');
  assert.ok(cta.flow.output?.directory.includes(destination.id));
  const legacy = buildImportPlan(
    manifest(),
    destination,
    [reference(randomUUID())],
    [randomUUID()],
  ).tasks[0];
  assert.ok(legacy?.executor === 'google-flow');
  assert.equal('output' in legacy.flow, false);
  assert.equal('imageSourceTaskKey' in legacy.flow, false);
});
