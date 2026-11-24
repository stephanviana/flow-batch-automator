import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import type { TaskSummary } from '@flow-batch/protocol';
import { blockedFixture } from './dispatch-recovery-support.js';
import { flowInput } from './flow-support.js';
import { updateAutoRetry } from '../src/orders/auto-retry.js';
import { QueueDatabase } from '../src/queue/database.js';
import { QueueRepository } from '../src/queue/repository.js';
import { QueueMutations } from '../src/queue/mutations.js';
import { FlowRetries } from '../src/queue/flow-retries.js';

const safeError = {
  code: 'flow_project_missing',
  message: 'Project unavailable before submission',
  retryable: true,
  notSubmitted: true,
};

type BaseFixture = Awaited<ReturnType<typeof blockedFixture>>;
interface AutomaticFixture extends BaseFixture {
  sql: BaseFixture['f']['database'];
  clientId: string;
  database: QueueDatabase;
  queue: QueueRepository;
  mutations: QueueMutations;
  now: number;
  policyId: string;
  task: TaskSummary;
  connectionId: string;
  active: NonNullable<ReturnType<QueueRepository['claim']>>;
  fail: (
    attemptId: string,
    error?: NonNullable<TaskSummary['lastError']>,
    at?: number,
  ) => void;
}

async function automaticFixture(t: TestContext): Promise<AutomaticFixture> {
  const fixture = await blockedFixture(t);
  const sql = fixture.f.database;
  const clientId = String(
    sql
      .prepare('SELECT client_id FROM dispatch_commands WHERE id=?')
      .get(fixture.commandId)!.client_id,
  );
  const database = new QueueDatabase(sql);
  const queue = new QueueRepository(database);
  const mutations = new QueueMutations(database);
  const now = Date.now();
  const policyId = randomUUID();
  updateAutoRetry(sql, fixture.order, policyId, true, now);
  const [task] = queue.enqueue(clientId, randomUUID(), [flowInput()], now);
  assert.ok(task);
  sql
    .prepare('UPDATE queue_tasks SET batch_id=? WHERE id=?')
    .run(fixture.batchId, task.id);
  queue.control(clientId, true);
  const connectionId = randomUUID();
  const active = queue.claim(task.id, connectionId, now);
  assert.ok(active?.activeAttemptId);
  const fail = (
    attemptId: string,
    error: NonNullable<TaskSummary['lastError']> = safeError,
    at = now + 1,
  ): void => {
    mutations.progress(
      clientId,
      connectionId,
      {
        type: 'queue-progress',
        taskId: task.id,
        attemptId,
        state: 'failed',
        error,
      },
      at,
    );
  };
  return {
    ...fixture,
    sql,
    clientId,
    database,
    queue,
    mutations,
    now,
    policyId,
    task,
    connectionId,
    active,
    fail,
  };
}

test('an order policy funds one delayed retry, preserves its first attempt and cannot fund a third attempt', async (t) => {
  const f = await automaticFixture(t);
  f.fail(f.active.activeAttemptId!);
  const first = f.database.detail(f.task.id, f.clientId);
  assert.equal(first.task.state, 'queued');
  assert.equal(first.task.maxAttempts, 2);
  assert.equal(first.task.nextAttemptAt, f.now + 15_001);
  assert.deepEqual(first.input, f.active.input);
  assert.deepEqual(first.attempts[0]?.error, safeError);
  assert.equal(first.attempts[0]?.state, 'failed');
  assert.equal(
    new FlowRetries(f.database).scheduleAutomatic(f.active, f.now + 2),
    false,
  );
  assert.equal(
    f.queue.claim(f.task.id, f.connectionId, f.now + 15_000),
    undefined,
  );
  const retry = f.queue.claim(f.task.id, f.connectionId, f.now + 15_001);
  assert.ok(retry?.activeAttemptId);
  assert.equal(retry.flowApprovalAt, f.now);
  f.fail(retry.activeAttemptId, safeError, f.now + 15_002);
  const after = f.database.detail(f.task.id, f.clientId);
  assert.equal(after.task.state, 'failed');
  assert.equal(after.task.attemptCount, 2);
  assert.deepEqual(after.attempts[0], first.attempts[0]);
  assert.equal(
    f.sql
      .prepare('SELECT COUNT(*) AS n FROM queue_flow_retry_authorizations')
      .get()!.n,
    1,
  );
});

test('expiration and revocation after scheduling prevent the pending automatic retry from being claimed', async (t) => {
  for (const restriction of ['expiration', 'revocation'] as const) {
    await t.test(restriction, async (t) => {
      const f = await automaticFixture(t);
      f.fail(f.active.activeAttemptId!);
      assert.equal(f.database.task(f.task.id).summary.state, 'queued');
      const claimAt =
        restriction === 'expiration' ? f.now + 86_400_000 : f.now + 15_001;
      if (restriction === 'revocation')
        updateAutoRetry(f.sql, f.order, randomUUID(), false, f.now + 2);
      assert.equal(
        f.queue.claim(f.task.id, f.connectionId, claimAt),
        undefined,
      );
      assert.equal(f.database.detail(f.task.id, f.clientId).attempts.length, 1);
    });
  }
});

test('automatic retry rejects missing policies, closed groups, removed orders and revoked identities', async (t) => {
  for (const restriction of [
    'policy',
    'closed',
    'archived',
    'identity',
  ] as const) {
    await t.test(restriction, async (t) => {
      const f = await automaticFixture(t);
      if (restriction === 'policy')
        updateAutoRetry(f.sql, f.order, randomUUID(), false, f.now);
      if (restriction === 'closed')
        f.sql
          .prepare(
            'INSERT INTO dispatch_closures(dispatch_id,review_hash,preparation_hash,note,closed_at) VALUES (?,?,?,?,?)',
          )
          .run(
            f.commandId,
            'a'.repeat(64),
            'b'.repeat(64),
            'Closed fixture',
            f.now,
          );
      if (restriction === 'archived')
        f.sql
          .prepare('UPDATE production_orders SET archived_at=? WHERE id=?')
          .run(f.now, f.order.id);
      if (restriction === 'identity')
        f.sql
          .prepare('UPDATE clients SET revoked_at=? WHERE id=?')
          .run(f.now, f.clientId);
      f.fail(f.active.activeAttemptId!);
      assert.equal(f.database.task(f.task.id).summary.state, 'failed');
      assert.equal(
        f.sql
          .prepare('SELECT COUNT(*) AS n FROM queue_flow_retry_authorizations')
          .get()!.n,
        0,
      );
    });
  }
});

test('a persisted failure after submission cannot be automatically retried even with a retryable error', async (t) => {
  const f = await automaticFixture(t);
  f.mutations.progress(
    f.clientId,
    f.connectionId,
    {
      type: 'queue-progress',
      taskId: f.task.id,
      attemptId: f.active.activeAttemptId!,
      generationId: `flow-${f.active.activeAttemptId}`,
      state: 'submitted',
    },
    f.now + 1,
  );
  f.fail(f.active.activeAttemptId!, safeError, f.now + 2);
  assert.equal(f.database.task(f.task.id).summary.safeToRetry, false);
  assert.equal(
    new FlowRetries(f.database).scheduleAutomatic(f.active, f.now + 3),
    false,
  );
  assert.equal(f.database.task(f.task.id).summary.state, 'failed');
  assert.equal(
    f.sql
      .prepare('SELECT COUNT(*) AS n FROM queue_flow_retry_authorizations')
      .get()!.n,
    0,
  );
});
