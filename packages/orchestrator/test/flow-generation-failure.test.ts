import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { QueueCheckpoint } from '@flow-batch/protocol';
import { queueFixture } from './queue-support.js';
import { flowInput } from './flow-support.js';
import { FlowImages } from '../src/queue/flow-images.js';

for (const code of ['flow_unsafe_generation', 'flow_video_lookup_failed'])
  test(`a confirmed ${code} preserves the attempt and permits the next authorized take`, async (t) => {
    const f = await queueFixture(t);
    const [refused, next] = f.repository.enqueue(f.clientId, randomUUID(), [
      flowInput(),
      flowInput(),
    ]);
    assert.ok(refused && next);
    f.repository.control(f.clientId, true);
    const connectionId = randomUUID();
    const active = f.repository.claim(refused.id, connectionId);
    assert.ok(active?.activeAttemptId);
    const base = {
      type: 'queue-progress' as const,
      taskId: refused.id,
      attemptId: active.activeAttemptId,
    };
    const mediaId = randomUUID();
    const frame = {
      type: 'queue-checkpoint' as const,
      taskId: refused.id,
      attemptId: active.activeAttemptId,
      mediaId,
    };
    f.mutations.progress(f.clientId, connectionId, {
      ...base,
      state: 'submitted',
      generationId: `flow-${active.activeAttemptId}`,
    });
    f.mutations.checkpoint(f.clientId, connectionId, {
      ...frame,
      stage: 'reference_uploaded',
      mediaId: randomUUID(),
    });
    f.mutations.progress(f.clientId, connectionId, {
      ...base,
      state: 'generating',
      generationId: `flow-${active.activeAttemptId}`,
    });
    f.mutations.checkpoint(f.clientId, connectionId, {
      ...frame,
      stage: 'image_generated',
    });
    f.mutations.checkpoint(f.clientId, connectionId, {
      type: 'queue-checkpoint',
      taskId: refused.id,
      attemptId: active.activeAttemptId,
      stage: 'video_submitted',
      operationId: randomUUID(),
    });
    assert.equal(
      f.mutations.progress(f.clientId, connectionId, {
        ...base,
        state: 'failed',
        error: {
          code,
          message: 'Confirmed safety rejection',
          notSubmitted: false,
          retryable: false,
        },
      }),
      true,
    );
    const snapshot = f.repository.snapshot(f.clientId);
    assert.equal(snapshot.running, true);
    assert.equal(snapshot.blockedByReview, false);
    assert.equal(
      f.repository.candidate([f.clientId], [f.clientId])?.summary.id,
      next.id,
    );
    const detail = f.queueDatabase.detail(refused.id, f.clientId);
    assert.equal(detail.task.state, 'failed');
    assert.equal(detail.task.attemptCount, 1);
    assert.equal(detail.attempts.length, 1);
    assert.equal(detail.attempts[0]?.error?.code, code);
    if (code === 'flow_unsafe_generation') {
      assert.throws(
        () =>
          f.mutations.action(f.clientId, {
            action: 'retry_flow',
            requestId: randomUUID(),
            taskId: refused.id,
            expectedRevision: detail.task.revision,
            confirmedFailure: true,
            approve: true,
            startQueue: false,
          }),
        /revisão no chat/,
      );
      return;
    }
    f.mutations.action(f.clientId, {
      action: 'retry_flow',
      requestId: randomUUID(),
      taskId: refused.id,
      expectedRevision: detail.task.revision,
      confirmedFailure: true,
      approve: true,
      startQueue: false,
    });
    const retry = f.repository.claim(refused.id, connectionId);
    assert.ok(retry?.activeAttemptId);
    assert.deepEqual(new FlowImages(f.database).forAttempt(retry), {
      taskId: refused.id,
      mediaId,
    });
    for (const state of ['submitted', 'generating'] as const)
      f.mutations.progress(f.clientId, connectionId, {
        ...base,
        attemptId: retry.activeAttemptId,
        state,
        generationId: `flow-${retry.activeAttemptId}`,
      });
    const reused: QueueCheckpoint = {
      ...frame,
      attemptId: retry.activeAttemptId,
      stage: 'image_reused',
      sourceTaskId: refused.id,
    };
    assert.throws(
      () =>
        f.mutations.checkpoint(f.clientId, connectionId, {
          ...reused,
          mediaId: randomUUID(),
        }),
      /source checkpoint/,
    );
    assert.equal(
      f.mutations.checkpoint(f.clientId, connectionId, reused),
      true,
    );
    assert.deepEqual(
      f.queueDatabase.detail(refused.id, f.clientId).attempts[0],
      detail.attempts[0],
    );
  });
