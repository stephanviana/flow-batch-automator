import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  queueSnapshotSchema,
  taskStateSchema,
  taskSummarySchema,
  type TaskSummary,
  type QueueSnapshot,
} from '@flow-batch/protocol';
import { queueActivity } from '../src/queue-activity.js';

function task(
  state: TaskSummary['state'],
  step: TaskSummary['step'] = null,
): TaskSummary {
  return taskSummarySchema.parse({
    id: randomUUID(),
    taskKey: randomUUID(),
    executor: 'google-flow',
    step,
    product: 'Product',
    video: 'Video',
    format: '9:16',
    take: 'Hook',
    state,
    attemptCount: 1,
    maxAttempts: 1,
    revision: 1,
    createdAt: 100,
    updatedAt: 200,
    nextAttemptAt: 100,
    generationId: null,
    safeToRetry: false,
    result: null,
    lastError: null,
  });
}
function queue(tasks: TaskSummary[], running = true): QueueSnapshot {
  const counts = Object.fromEntries(
    taskStateSchema.options.map((state) => [
      state,
      tasks.filter((entry) => entry.state === state).length,
    ]),
  );
  return queueSnapshotSchema.parse({
    tasks,
    running,
    counts,
    blockedByReview: tasks.some((entry) => entry.state === 'uncertain'),
  });
}
test('the activity card follows confirmed reference, image, video and download stages', () => {
  const stages: [TaskSummary['state'], TaskSummary['step'], number, string][] =
    [
      ['dispatching', null, 0, 'referência'],
      ['generating', 'reference_uploaded', 1, 'imagem'],
      ['generating', 'image_generated', 2, 'vídeo'],
      ['generating', 'video_submitted', 2, 'vídeo'],
      ['download_pending', 'download_started', 3, 'MP4'],
    ];
  for (const [state, checkpoint, step, title] of stages) {
    const view = queueActivity(queue([task(state, checkpoint)]));
    assert.equal(view.step, step);
    assert.equal(view.busy, true);
    assert.equal(view.tone, 'working');
    assert.ok(view.title.includes(title));
    assert.ok(view.detail.includes(`Etapa ${step + 1} de 4`));
  }
});
test('starting a download is not a completed take; only completion turns the card green', () => {
  const downloading = queueActivity(
    queue([task('download_pending', 'download_started')]),
  );
  assert.notEqual(downloading.tone, 'success');
  assert.equal(downloading.step, 3);
  const completed = queueActivity(
    queue([task('completed', 'download_started')]),
  );
  assert.equal(completed.tone, 'success');
  assert.equal(completed.step, 4);
  assert.equal(completed.busy, false);
  assert.ok(completed.title.includes('MP4 disponível'));
});
test('an uncertain result stops the spinner and requires review instead of showing completion', () => {
  const view = queueActivity(queue([task('uncertain', 'video_submitted')]));
  assert.equal(view.busy, false);
  assert.equal(view.tone, 'warning');
  assert.equal(view.step, 2);
  assert.ok(view.title.includes('revisão'));
});
test('pausing the queue still shows the in-flight take as processing', () => {
  const view = queueActivity(
    queue([task('generating', 'reference_uploaded')], false),
  );
  assert.equal(view.busy, true);
  assert.equal(view.tone, 'working');
  assert.ok(view.detail.includes('pausada'));
});
test('pending work takes precedence over old successes and unavailable state never claims a take completed', () => {
  const waiting = queueActivity(
    queue([task('completed'), task('queued')], false),
  );
  assert.equal(waiting.title, 'Fila pausada');
  assert.notEqual(waiting.tone, 'success');
  assert.equal(queueActivity(null).busy, false);
  assert.notEqual(queueActivity(null).tone, 'success');
  const empty = queueActivity(queue([]));
  assert.equal(empty.busy, false);
  assert.ok(empty.title.includes('sem pendências'));
});
