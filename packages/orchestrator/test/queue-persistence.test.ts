import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { queueFixture, taskInput, progress } from './queue-support.js';

test('enqueue is transactional and idempotent by request and task key, preserving original materials', async (t) => {
  const f = await queueFixture(t);
  const input = taskInput();
  const requestId = randomUUID();
  const [created] = f.repository.enqueue(f.clientId, requestId, [input]);
  assert.ok(created);
  assert.deepEqual(f.queueDatabase.detail(created.id, f.clientId).input, input);
  assert.deepEqual(f.repository.enqueue(f.clientId, requestId, [input]), [
    created,
  ]);
  assert.deepEqual(f.repository.enqueue(f.clientId, randomUUID(), [input]), [
    created,
  ]);
  assert.throws(
    () => f.repository.enqueue(f.clientId, requestId, [taskInput()]),
    /different tasks/,
  );
  assert.throws(
    () =>
      f.repository.enqueue(f.clientId, randomUUID(), [
        taskInput(),
        { ...input, take: 'Changed' },
      ]),
    /different materials/,
  );
  assert.equal(f.repository.snapshot(f.clientId).tasks.length, 1);
  assert.equal(f.repository.snapshot(f.clientId).running, false);
  assert.equal(f.repository.claim(created.id, randomUUID()), undefined);
});

test('SQLite enforces one active task globally and progress is ordered and deduplicated', async (t) => {
  const f = await queueFixture(t);
  const tasks = f.repository.enqueue(f.clientId, randomUUID(), [
    taskInput(),
    taskInput({ take: 'Body' }),
  ]);
  assert.ok(tasks[0] && tasks[1]);
  f.repository.control(f.clientId, true);
  const connectionId = randomUUID();
  const active = f.repository.claim(tasks[0].id, connectionId);
  assert.ok(active?.activeAttemptId);
  assert.equal(f.repository.claim(tasks[1].id, randomUUID()), undefined);
  assert.throws(
    () =>
      f.database
        .prepare("UPDATE queue_tasks SET state='dispatching' WHERE id=?")
        .run(tasks[1]!.id),
    /UNIQUE/,
  );
  assert.throws(
    () =>
      f.mutations.progress(
        f.clientId,
        connectionId,
        progress(active.summary.id, active.activeAttemptId!, 'generating'),
      ),
    /Invalid task transition/,
  );
  for (const state of [
    'submitted',
    'generating',
    'download_pending',
    'completed',
  ] as const) {
    const event = progress(active.summary.id, active.activeAttemptId, state);
    assert.equal(f.mutations.progress(f.clientId, connectionId, event), true);
    assert.equal(f.mutations.progress(f.clientId, connectionId, event), false);
  }
  const detail = f.queueDatabase.detail(active.summary.id, f.clientId);
  assert.equal(detail.task.state, 'completed');
  assert.equal(detail.task.result?.outputFile, null);
  assert.deepEqual(
    detail.events.map((event) => event.state),
    [
      'queued',
      'dispatching',
      'submitted',
      'generating',
      'download_pending',
      'completed',
    ],
  );
  assert.ok(f.repository.claim(tasks[1].id, connectionId));
});

test('safe retries obey backoff and budget; late events cannot finish a newer attempt', async (t) => {
  const f = await queueFixture(t);
  const [task] = f.repository.enqueue(
    f.clientId,
    randomUUID(),
    [taskInput({ maxAttempts: 2 })],
    100,
  );
  assert.ok(task);
  f.repository.control(f.clientId, true);
  const connectionId = randomUUID();
  const first = f.repository.claim(task.id, connectionId, 100);
  assert.ok(first?.activeAttemptId);
  f.mutations.progress(
    f.clientId,
    connectionId,
    {
      type: 'queue-progress',
      taskId: task.id,
      attemptId: first.activeAttemptId,
      state: 'failed',
      error: {
        code: 'temporary',
        message: 'Before submission',
        retryable: true,
        notSubmitted: true,
      },
    },
    200,
  );
  assert.equal(f.repository.claim(task.id, connectionId, 1199), undefined);
  const second = f.repository.claim(task.id, connectionId, 1200);
  assert.ok(second?.activeAttemptId);
  assert.notEqual(second.activeAttemptId, first.activeAttemptId);
  assert.equal(
    f.mutations.progress(
      f.clientId,
      connectionId,
      progress(task.id, first.activeAttemptId, 'completed'),
      1300,
    ),
    false,
  );
  assert.equal(
    f.mutations.progress(
      f.clientId,
      randomUUID(),
      progress(task.id, second.activeAttemptId, 'submitted'),
      1300,
    ),
    false,
  );
  f.mutations.progress(
    f.clientId,
    connectionId,
    {
      type: 'queue-progress',
      taskId: task.id,
      attemptId: second.activeAttemptId,
      state: 'failed',
      error: {
        code: 'temporary',
        message: 'Before submission',
        retryable: true,
        notSubmitted: true,
      },
    },
    1400,
  );
  const failed = f.queueDatabase.task(task.id).summary;
  assert.equal(failed.state, 'failed');
  assert.equal(failed.attemptCount, 2);
  assert.throws(
    () =>
      f.mutations.action(f.clientId, {
        action: 'retry',
        requestId: randomUUID(),
        taskId: task.id,
        expectedRevision: failed.revision,
        acknowledgeDuplicateRisk: false,
      }),
    /budget exhausted/,
  );
});

test('post-submission failure never auto retries, even with an invalid safe-retry claim', async (t) => {
  const f = await queueFixture(t);
  const [task] = f.repository.enqueue(f.clientId, randomUUID(), [taskInput()]);
  assert.ok(task);
  f.repository.control(f.clientId, true);
  const connectionId = randomUUID();
  const claimed = f.repository.claim(task.id, connectionId);
  assert.ok(claimed?.activeAttemptId);
  f.mutations.progress(
    f.clientId,
    connectionId,
    progress(task.id, claimed.activeAttemptId, 'submitted'),
  );
  f.mutations.progress(f.clientId, connectionId, {
    type: 'queue-progress',
    taskId: task.id,
    attemptId: claimed.activeAttemptId,
    state: 'failed',
    error: {
      code: 'after_submission',
      message: 'Generation failed',
      retryable: true,
      notSubmitted: true,
    },
  });
  const failed = f.queueDatabase.task(task.id).summary;
  assert.equal(failed.state, 'failed');
  assert.equal(failed.safeToRetry, false);
  const action = {
    action: 'retry' as const,
    requestId: randomUUID(),
    taskId: task.id,
    expectedRevision: failed.revision,
    acknowledgeDuplicateRisk: false,
  };
  assert.throws(
    () => f.mutations.action(f.clientId, action),
    /risk acknowledgement/,
  );
  const explicit = { ...action, acknowledgeDuplicateRisk: true };
  f.mutations.action(f.clientId, explicit);
  const revision = f.queueDatabase.task(task.id).summary.revision;
  f.mutations.action(f.clientId, explicit);
  assert.equal(f.queueDatabase.task(task.id).summary.revision, revision);
  assert.throws(
    () =>
      f.mutations.action(f.clientId, {
        ...explicit,
        expectedRevision: revision,
      }),
    /reused/,
  );
});

test('restart fences in-flight work as uncertain, preserves pending tasks and requires review before retry', async (t) => {
  const f = await queueFixture(t);
  const input = taskInput();
  const tasks = f.repository.enqueue(f.clientId, randomUUID(), [
    input,
    taskInput({ take: 'CTA' }),
  ]);
  assert.ok(tasks[0] && tasks[1]);
  f.repository.control(f.clientId, true);
  const connectionId = randomUUID();
  const active = f.repository.claim(tasks[0].id, connectionId);
  assert.ok(active?.activeAttemptId);
  f.mutations.progress(
    f.clientId,
    connectionId,
    progress(active.summary.id, active.activeAttemptId, 'submitted'),
  );
  await f.app.close();
  const reopened = createApp(f.config);
  try {
    const uncertain = f.queueDatabase.task(tasks[0].id).summary;
    assert.equal(uncertain.state, 'uncertain');
    assert.equal(f.queueDatabase.task(tasks[1].id).summary.state, 'queued');
    assert.equal(f.repository.snapshot(f.clientId).running, false);
    assert.equal(f.repository.blocked(), true);
    assert.throws(
      () => f.repository.control(f.clientId, true),
      /Resolve uncertain/,
    );
    assert.equal(
      f.mutations.progress(
        f.clientId,
        connectionId,
        progress(uncertain.id, active.activeAttemptId, 'completed'),
      ),
      false,
    );
    assert.throws(
      () =>
        f.mutations.action(f.clientId, {
          action: 'retry',
          requestId: randomUUID(),
          taskId: uncertain.id,
          expectedRevision: uncertain.revision,
          acknowledgeDuplicateRisk: true,
        }),
      /reviewed/,
    );
    const resolved = f.mutations.action(f.clientId, {
      action: 'resolve',
      requestId: randomUUID(),
      taskId: uncertain.id,
      expectedRevision: uncertain.revision,
      outcome: 'not_submitted',
      note: 'Operator confirmed no external submission',
    });
    assert.equal(resolved.state, 'failed');
    assert.equal(f.repository.blocked(), false);
    f.mutations.action(f.clientId, {
      action: 'retry',
      requestId: randomUUID(),
      taskId: resolved.id,
      expectedRevision: resolved.revision,
      acknowledgeDuplicateRisk: false,
    });
    assert.equal(f.repository.claim(resolved.id, connectionId), undefined);
    f.repository.control(f.clientId, true);
    assert.ok(f.repository.claim(resolved.id, connectionId));
    assert.deepEqual(
      f.queueDatabase.detail(resolved.id, f.clientId).input.original,
      input.original,
    );
  } finally {
    await reopened.close();
  }
});

test('cancellation is revision-checked and owner-scoped and never executes pending work', async (t) => {
  const f = await queueFixture(t);
  const [task] = f.repository.enqueue(f.clientId, randomUUID(), [taskInput()]);
  assert.ok(task);
  const action = {
    action: 'cancel' as const,
    requestId: randomUUID(),
    taskId: task.id,
    expectedRevision: task.revision,
  };
  assert.throws(() => f.mutations.action(randomUUID(), action), /not found/);
  assert.throws(
    () => f.mutations.action(f.clientId, { ...action, expectedRevision: 99 }),
    /Task changed/,
  );
  f.mutations.action(f.clientId, action);
  f.mutations.action(f.clientId, action);
  assert.equal(f.queueDatabase.task(task.id).summary.state, 'cancelled');
  assert.equal(f.queueDatabase.detail(task.id, f.clientId).events.length, 2);
  f.repository.control(f.clientId, true);
  assert.equal(f.repository.claim(task.id, randomUUID()), undefined);
});
