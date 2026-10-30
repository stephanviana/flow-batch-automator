import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { type QueueCheckpoint, type QueueProgress } from '@flow-batch/protocol';
import { queueFixture, taskInput } from './queue-support.js';
import { flowInput } from './flow-support.js';

test('real queue requires v4 capability, records original materials and allows one attempt only', async (t) => {
  const f = await queueFixture(t);
  const input = flowInput();
  const [task] = f.repository.enqueue(f.clientId, randomUUID(), [input]);
  assert.ok(task);
  f.repository.control(f.clientId, true);
  assert.equal(f.repository.candidate([f.clientId]), undefined);
  assert.equal(
    f.repository.candidate([f.clientId], [f.clientId])?.summary.id,
    task.id,
  );
  const active = f.repository.claim(task.id, randomUUID());
  assert.ok(active?.deadlineAt);
  assert.ok(active.deadlineAt > Date.now() + 290000);
  assert.deepEqual(
    f.queueDatabase.detail(task.id, f.clientId).input.original,
    input.original,
  );
});

test('real completion requires ordered, fenced checkpoints and matching download evidence', async (t) => {
  const f = await queueFixture(t);
  const [task] = f.repository.enqueue(f.clientId, randomUUID(), [flowInput()]);
  assert.ok(task);
  f.repository.control(f.clientId, true);
  const connectionId = randomUUID();
  const active = f.repository.claim(task.id, connectionId);
  assert.ok(active?.activeAttemptId);
  const attemptId = active.activeAttemptId;
  const progress = (
    state: 'submitted' | 'generating' | 'download_pending',
  ): void => {
    f.mutations.progress(f.clientId, connectionId, {
      type: 'queue-progress',
      taskId: task.id,
      attemptId,
      state,
      generationId: `flow-${attemptId}`,
    });
  };
  const reference: QueueCheckpoint = {
    type: 'queue-checkpoint',
    taskId: task.id,
    attemptId,
    stage: 'reference_uploaded',
    mediaId: randomUUID(),
  };
  assert.equal(
    f.mutations.checkpoint(f.clientId, randomUUID(), reference),
    false,
  );
  assert.throws(
    () => f.mutations.checkpoint(f.clientId, connectionId, reference),
    /state/,
  );
  progress('submitted');
  const firstDeadline = f.queueDatabase.task(task.id).deadlineAt;
  assert.ok(firstDeadline && firstDeadline > Date.now() + 1790000);
  assert.equal(
    f.mutations.checkpoint(f.clientId, connectionId, reference),
    true,
  );
  assert.equal(
    f.mutations.checkpoint(f.clientId, connectionId, reference),
    false,
  );
  assert.throws(
    () =>
      f.mutations.checkpoint(f.clientId, connectionId, {
        ...reference,
        mediaId: randomUUID(),
      }),
    /identity/,
  );
  progress('generating');
  const imageId = randomUUID(),
    operationId = randomUUID(),
    videoId = randomUUID();
  const checkpoint = (event: QueueCheckpoint): void => {
    f.mutations.checkpoint(f.clientId, connectionId, event);
  };
  assert.throws(
    () => checkpoint({ ...reference, stage: 'video_submitted', operationId }),
    /order/,
  );
  checkpoint({
    type: 'queue-checkpoint',
    taskId: task.id,
    attemptId,
    stage: 'image_generated',
    mediaId: imageId,
  });
  checkpoint({
    type: 'queue-checkpoint',
    taskId: task.id,
    attemptId,
    stage: 'video_submitted',
    operationId,
  });
  checkpoint({
    type: 'queue-checkpoint',
    taskId: task.id,
    attemptId,
    stage: 'video_ready',
    mediaId: videoId,
  });
  progress('download_pending');
  const completion: QueueProgress = {
    type: 'queue-progress',
    taskId: task.id,
    attemptId,
    state: 'completed',
    generationId: `flow-${attemptId}`,
    result: {
      simulated: false,
      outputFile: `FlowBatch/${task.id}/take.mp4`,
      downloadId: 17,
      imageMediaId: imageId,
      videoMediaId: videoId,
      operationId,
      description: 'Download complete',
    },
  };
  assert.throws(
    () => f.mutations.progress(f.clientId, connectionId, completion),
    /evidence/,
  );
  checkpoint({
    type: 'queue-checkpoint',
    taskId: task.id,
    attemptId,
    stage: 'download_started',
    downloadId: 17,
  });
  assert.ok(!completion.result.simulated);
  const mismatchedResult = { ...completion.result, videoMediaId: randomUUID() };
  assert.throws(
    () =>
      f.mutations.progress(f.clientId, connectionId, {
        ...completion,
        result: mismatchedResult,
      }),
    /evidence/,
  );
  f.mutations.progress(f.clientId, connectionId, completion);
  assert.equal(f.queueDatabase.task(task.id).summary.state, 'completed');
  assert.equal(
    f.queueDatabase.detail(task.id, f.clientId).checkpoints.length,
    5,
  );
});

test('unknown Flow outcome pauses all dispatch and review cannot fabricate a real download or authorize a retry', async (t) => {
  const f = await queueFixture(t);
  const [task, pending] = f.repository.enqueue(f.clientId, randomUUID(), [
    flowInput(),
    taskInput(),
  ]);
  assert.ok(task && pending);
  f.repository.control(f.clientId, true);
  const connectionId = randomUUID();
  const active = f.repository.claim(task.id, connectionId);
  assert.ok(active?.activeAttemptId);
  f.mutations.progress(f.clientId, connectionId, {
    type: 'queue-progress',
    taskId: task.id,
    attemptId: active.activeAttemptId,
    state: 'uncertain',
    error: {
      code: 'flow_request_unknown',
      message: 'Review required',
      retryable: true,
      notSubmitted: true,
    },
  });
  const snapshot = f.repository.snapshot(f.clientId);
  assert.equal(snapshot.running, false);
  assert.equal(snapshot.blockedByReview, true);
  assert.equal(f.repository.claim(pending.id, randomUUID()), undefined);
  const action = {
    action: 'resolve' as const,
    requestId: randomUUID(),
    taskId: task.id,
    expectedRevision: f.queueDatabase.task(task.id).summary.revision,
    note: 'Reviewed in Flow',
    outcome: 'completed' as const,
  };
  assert.throws(() => f.mutations.action(f.clientId, action), /download/);
  f.mutations.action(f.clientId, { ...action, outcome: 'failed' });
  assert.throws(
    () =>
      f.mutations.action(f.clientId, {
        action: 'retry',
        requestId: randomUUID(),
        taskId: task.id,
        expectedRevision: f.queueDatabase.task(task.id).summary.revision,
        acknowledgeDuplicateRisk: true,
      }),
    /budget/,
  );
  assert.equal(f.repository.snapshot(f.clientId).running, false);
});
