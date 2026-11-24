import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  queueActionSchema,
  type FlowRetryAction,
  type QueueCheckpoint,
  type QueueProgress,
} from '@flow-batch/protocol';
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

test('unknown Flow outcome pauses dispatch until review, and a new authorization funds exactly one attempt', async (t) => {
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
    /Autorize uma nova tentativa/,
  );
  assert.equal(f.repository.snapshot(f.clientId).running, false);
  const closed = f.queueDatabase.detail(task.id, f.clientId);
  const retry: FlowRetryAction = {
    action: 'retry_flow',
    requestId: randomUUID(),
    taskId: task.id,
    expectedRevision: closed.task.revision,
    confirmedFailure: true,
    approve: true,
    startQueue: false,
  };
  assert.equal(
    queueActionSchema.safeParse({ ...retry, confirmedFailure: false }).success,
    false,
  );
  assert.equal(
    queueActionSchema.safeParse({ ...retry, approve: false }).success,
    false,
  );
  const approvedAt = Date.now() + 1000;
  const scheduled = f.mutations.action(f.clientId, retry, approvedAt, 'orders');
  assert.equal(scheduled.state, 'queued');
  assert.equal(scheduled.maxAttempts, 2);
  assert.deepEqual(
    f.mutations.action(f.clientId, retry, approvedAt + 1),
    scheduled,
  );
  assert.throws(
    () => f.mutations.action(f.clientId, { ...retry, requestId: randomUUID() }),
    /refresh before acting/,
  );
  assert.equal(
    f.repository.claim(task.id, connectionId, approvedAt),
    undefined,
  );
  f.repository.control(f.clientId, true);
  const connected = [f.clientId];
  assert.equal(
    f.repository.candidate(connected, connected, connected, connected)?.summary
      .id,
    pending.id,
  );
  assert.equal(
    f.repository.candidate(
      connected,
      connected,
      connected,
      connected,
      connected,
    )?.summary.id,
    task.id,
  );
  const second = f.repository.claim(task.id, connectionId, approvedAt);
  assert.ok(second?.activeAttemptId);
  assert.notEqual(second.activeAttemptId, active.activeAttemptId);
  assert.equal(second.flowApprovalAt, approvedAt);
  const detail = f.queueDatabase.detail(task.id, f.clientId);
  assert.deepEqual(detail.input, closed.input);
  assert.deepEqual(detail.attempts[0], closed.attempts[0]);
  assert.equal(detail.attempts[1]?.number, 2);
  assert.equal(
    f.mutations.progress(f.clientId, connectionId, {
      type: 'queue-progress',
      taskId: task.id,
      attemptId: active.activeAttemptId,
      state: 'generating',
      generationId: `flow-${active.activeAttemptId}`,
    }),
    false,
  );
});

test('retry is refused after the Flow video was located even if the download is uncertain', async (t) => {
  const f = await queueFixture(t);
  const [task] = f.repository.enqueue(f.clientId, randomUUID(), [flowInput()]);
  assert.ok(task);
  f.repository.control(f.clientId, true);
  const connection = randomUUID();
  const active = f.repository.claim(task.id, connection);
  assert.ok(active?.activeAttemptId);
  const mediaId = randomUUID();
  f.database
    .prepare(
      'INSERT INTO queue_checkpoints (task_id,attempt_id,stage,at,payload) VALUES (?,?,?,?,?)',
    )
    .run(
      task.id,
      active.activeAttemptId,
      'video_ready',
      Date.now(),
      JSON.stringify({
        type: 'queue-checkpoint',
        taskId: task.id,
        attemptId: active.activeAttemptId,
        stage: 'video_ready',
        mediaId,
      }),
    );
  f.mutations.interrupt(connection);
  const current = f.queueDatabase.task(task.id, f.clientId).summary;
  assert.equal(current.state, 'uncertain');
  assert.throws(
    () =>
      f.mutations.action(f.clientId, {
        action: 'retry_flow',
        requestId: randomUUID(),
        taskId: task.id,
        expectedRevision: current.revision,
        approve: true,
        confirmedFailure: true,
        startQueue: true,
      }),
    /vídeo já foi localizado/,
  );
  assert.equal(
    f.queueDatabase.task(task.id, f.clientId).summary.maxAttempts,
    1,
  );
  assert.equal(f.repository.snapshot(f.clientId).blockedByReview, true);
});
