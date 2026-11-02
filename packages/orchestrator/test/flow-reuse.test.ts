import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import {
  flowOutputPath,
  type QueueCheckpoint,
  type QueueExecute,
} from '@flow-batch/protocol';
import { queueFixture } from './queue-support.js';
import { flowInput } from './flow-support.js';
import { BatchStore } from '../src/persistence/batches.js';
import { FlowImages } from '../src/queue/flow-images.js';
import { QueueEngine } from '../src/queue/engine.js';
import type { QueueTransport } from '../src/queue/ports.js';

async function reuseFixture(t: TestContext): Promise<
  Awaited<ReturnType<typeof queueFixture>> & {
    body: ReturnType<typeof flowInput>;
    cta: ReturnType<typeof flowInput>;
  }
> {
  const f = await queueFixture(t);
  const body = flowInput();
  const batchId = randomUUID();
  const store = new BatchStore(f.database);
  store.action(f.clientId, {
    action: 'prepare',
    draft: { id: batchId, name: 'Reuse fixture', mode: 'existing-project' },
  });
  store.action(f.clientId, {
    action: 'attach',
    id: batchId,
    expectedRevision: 0,
    projectId: body.flow.projectId,
  });
  body.take = 'Body';
  body.flow.batchId = batchId;
  body.flow.output = { directory: 'lote/variacao', filename: '02-Body.mp4' };
  const cta = structuredClone(body);
  cta.taskKey = randomUUID();
  cta.take = 'CTA';
  cta.original.videoPrompt = 'Outra fala, mesma imagem';
  cta.flow.imageSourceTaskKey = body.taskKey;
  cta.flow.approval.imageGenerations = 0;
  cta.flow.output = { ...body.flow.output, filename: '03-CTA.mp4' };
  return { ...f, body, cta };
}
type ReuseFixture = Awaited<ReturnType<typeof reuseFixture>>;

function complete(
  f: ReuseFixture,
  taskId: string,
  input: ReuseFixture['body'],
  sourceTaskId?: string,
  imageId: string = randomUUID(),
): string {
  const connectionId = randomUUID();
  const active = f.repository.claim(taskId, connectionId);
  assert.ok(active?.activeAttemptId);
  const base = { taskId, attemptId: active.activeAttemptId };
  const progress = (
    state: 'submitted' | 'generating' | 'download_pending',
  ): void => {
    f.mutations.progress(f.clientId, connectionId, {
      ...base,
      type: 'queue-progress',
      state,
      generationId: `flow-${base.attemptId}`,
    });
  };
  const checkpoint = (event: QueueCheckpoint): void => {
    f.mutations.checkpoint(f.clientId, connectionId, event);
  };
  progress('submitted');
  if (!sourceTaskId)
    checkpoint({
      ...base,
      type: 'queue-checkpoint',
      stage: 'reference_uploaded',
      mediaId: randomUUID(),
    });
  progress('generating');
  if (sourceTaskId) {
    for (const patch of [
      { mediaId: randomUUID() },
      { sourceTaskId: randomUUID() },
    ])
      assert.throws(
        () =>
          checkpoint({
            ...base,
            type: 'queue-checkpoint',
            stage: 'image_reused',
            mediaId: imageId,
            sourceTaskId,
            ...patch,
          }),
        /source checkpoint/,
      );
    checkpoint({
      ...base,
      type: 'queue-checkpoint',
      stage: 'image_reused',
      mediaId: imageId,
      sourceTaskId,
    });
  } else
    checkpoint({
      ...base,
      type: 'queue-checkpoint',
      stage: 'image_generated',
      mediaId: imageId,
    });
  const operationId = randomUUID(),
    videoId = randomUUID();
  checkpoint({
    ...base,
    type: 'queue-checkpoint',
    stage: 'video_submitted',
    operationId,
  });
  checkpoint({
    ...base,
    type: 'queue-checkpoint',
    stage: 'video_ready',
    mediaId: videoId,
  });
  progress('download_pending');
  checkpoint({
    ...base,
    type: 'queue-checkpoint',
    stage: 'download_started',
    downloadId: 17,
  });
  const result = {
    simulated: false as const,
    outputFile: flowOutputPath(taskId, input.flow.output),
    downloadId: 17,
    imageMediaId: imageId,
    videoMediaId: videoId,
    operationId,
    description: 'Fixture download',
  };
  assert.throws(
    () =>
      f.mutations.progress(f.clientId, connectionId, {
        ...base,
        type: 'queue-progress',
        state: 'completed',
        generationId: `flow-${base.attemptId}`,
        result: { ...result, outputFile: `FlowBatch/${taskId}/take.mp4` },
      }),
    /evidence/,
  );
  f.mutations.progress(f.clientId, connectionId, {
    ...base,
    type: 'queue-progress',
    state: 'completed',
    generationId: `flow-${base.attemptId}`,
    result,
  });
  return imageId;
}

test('reuse requires a prior matching source and rejected imports roll back the entire transaction', async (t) => {
  const f = await reuseFixture(t);
  assert.throws(
    () => f.repository.enqueue(f.clientId, randomUUID(), [f.cta, f.body]),
    /Source image/,
  );
  assert.equal(f.repository.snapshot(f.clientId).tasks.length, 0);
  for (const change of [
    'project',
    'batch',
    'video',
    'prompt',
    'reference',
    'directory',
  ]) {
    const cta = structuredClone(f.cta);
    if (change === 'project') cta.flow.projectId = randomUUID();
    if (change === 'batch') cta.flow.batchId = randomUUID();
    if (change === 'video') cta.video = 'Outra variação';
    if (change === 'prompt') cta.original.imagePrompt = 'Outra pessoa';
    if (change === 'reference') cta.flow.reference.sha256 = 'b'.repeat(64);
    if (change === 'directory') cta.flow.output!.directory = 'outra';
    assert.throws(
      () => f.repository.enqueue(f.clientId, randomUUID(), [f.body, cta]),
      /Source image/,
    );
    assert.equal(f.repository.snapshot(f.clientId).tasks.length, 0);
  }
});

test('persisted Body image supplies the exact CTA frame and four fenced checkpoints complete its shared-folder download', async (t) => {
  const f = await reuseFixture(t);
  const [body, cta] = f.repository.enqueue(f.clientId, randomUUID(), [
    f.body,
    f.cta,
  ]);
  assert.ok(body && cta);
  f.repository.control(f.clientId, true);
  assert.equal(f.repository.candidate([f.clientId], [f.clientId]), undefined);
  assert.equal(
    f.repository.candidate([f.clientId], [f.clientId], [f.clientId])?.summary
      .id,
    body.id,
  );
  assert.throws(
    () => new FlowImages(f.database).resolve(f.clientId, f.cta),
    /complete/,
  );
  const imageId = complete(f, body.id, f.body);
  const reopened = new DatabaseSync(f.config.databasePath, { readOnly: true });
  try {
    assert.deepEqual(new FlowImages(reopened).resolve(f.clientId, f.cta), {
      taskId: body.id,
      mediaId: imageId,
    });
    assert.throws(
      () => new FlowImages(reopened).resolve(randomUUID(), f.cta),
      /owner/,
    );
  } finally {
    reopened.close();
  }
  complete(f, cta.id, f.cta, body.id, imageId);
  const source = f.queueDatabase.detail(body.id, f.clientId);
  const reused = f.queueDatabase.detail(cta.id, f.clientId);
  assert.equal(source.checkpoints.length, 5);
  assert.equal(reused.checkpoints.length, 4);
  assert.equal(reused.checkpoints[0]?.checkpoint.stage, 'image_reused');
  assert.equal(reused.task.state, 'completed');
  assert.equal(
    reused.task.result?.simulated === false && reused.task.result.imageMediaId,
    imageId,
  );
  assert.deepEqual(reused.input, f.cta);
});

test('engine transmits the persisted source ID and never dispatches CTA after a cancelled Body', async (t) => {
  for (const success of [true, false]) {
    const f = await reuseFixture(t);
    const [body, cta] = f.repository.enqueue(f.clientId, randomUUID(), [
      f.body,
      f.cta,
    ]);
    assert.ok(body && cta);
    f.repository.control(f.clientId, true);
    let imageId: string | undefined;
    if (success) imageId = complete(f, body.id, f.body);
    else
      f.mutations.action(f.clientId, {
        action: 'cancel',
        requestId: randomUUID(),
        taskId: body.id,
        expectedRevision: body.revision,
      });
    const sent: QueueExecute[] = [];
    const engine = new QueueEngine(f.repository, f.mutations, {
      queueConnections: (): ReturnType<QueueTransport['queueConnections']> => [
        {
          clientId: f.clientId,
          connectionId: randomUUID(),
          flowCapable: true,
          modernFlowCapable: true,
        },
      ],
      sendQueue: (_id, message): boolean => {
        sent.push(message);
        return true;
      },
      closeQueue: (): void => {},
    });
    try {
      engine.wake();
      for (
        let round = 0;
        round < 50 && f.queueDatabase.task(cta.id).summary.state === 'queued';
        round++
      )
        await delay(5);
      if (success) {
        assert.equal(sent.length, 1);
        assert.ok(sent[0]?.type === 'flow-execute');
        assert.deepEqual(sent[0].sourceImage, {
          taskId: body.id,
          mediaId: imageId,
        });
        assert.equal(sent[0].flow.approval.imageGenerations, 0);
      } else {
        assert.equal(sent.length, 0);
        assert.equal(f.queueDatabase.task(cta.id).summary.state, 'failed');
        assert.equal(
          f.queueDatabase.task(cta.id).summary.lastError?.code,
          'source_image_unavailable',
        );
      }
    } finally {
      engine.stop();
    }
  }
});
