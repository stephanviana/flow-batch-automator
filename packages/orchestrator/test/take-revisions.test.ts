import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  stableImportId,
  type QueueExecute,
  type FlowTakeRevision,
  type FlowRevisionPreparation,
  type TaskSummary,
} from '@flow-batch/protocol';
import { blockedFixture } from './dispatch-recovery-support.js';
import { flowInput } from './flow-support.js';
import { QueueDatabase } from '../src/queue/database.js';
import { QueueRepository } from '../src/queue/repository.js';
import { QueueMutations } from '../src/queue/mutations.js';
import { QueueEngine } from '../src/queue/engine.js';
import { FlowRevisionStore } from '../src/queue/flow-revisions.js';
import type { QueueTransport } from '../src/queue/ports.js';

type BaseFixture = Awaited<ReturnType<typeof blockedFixture>>;
type ApiReply = Awaited<ReturnType<BaseFixture['f']['app']['inject']>>;
interface RevisionFixture extends BaseFixture {
  clientId: string;
  database: QueueDatabase;
  queue: QueueRepository;
  mutations: QueueMutations;
  original: ReturnType<typeof flowInput>;
  task: TaskSummary;
  mediaId: string;
  connectionId: string;
  api: (path: string, payload?: Record<string, unknown>) => Promise<ApiReply>;
  draft: FlowRevisionPreparation;
}
async function refusedTake(t: TestContext): Promise<RevisionFixture> {
  const fixture = await blockedFixture(t);
  const { f, repository, order, batchId } = fixture;
  const clientId = String(
    f.database
      .prepare('SELECT client_id FROM dispatch_commands WHERE id=?')
      .get(fixture.commandId)!.client_id,
  );
  const database = new QueueDatabase(f.database);
  const queue = new QueueRepository(database);
  const mutations = new QueueMutations(database);
  const original = flowInput();
  const manifest = repository.get(order.id).preparation!.manifests[0]!;
  original.taskKey = await stableImportId([
    'flow-import-v1',
    batchId,
    manifest.id,
    manifest.tasks[0]!.id,
  ]);
  const [task] = queue.enqueue(clientId, randomUUID(), [original]);
  assert.ok(task);
  f.database
    .prepare('UPDATE queue_tasks SET batch_id=? WHERE id=?')
    .run(batchId, task.id);
  queue.control(clientId, true);
  const connectionId = randomUUID();
  const active = queue.claim(task.id, connectionId)!;
  const base = { taskId: task.id, attemptId: active.activeAttemptId! };
  mutations.progress(clientId, connectionId, {
    ...base,
    type: 'queue-progress',
    state: 'submitted',
    generationId: `flow-${base.attemptId}`,
  });
  mutations.checkpoint(clientId, connectionId, {
    ...base,
    type: 'queue-checkpoint',
    stage: 'reference_uploaded',
    mediaId: randomUUID(),
  });
  mutations.progress(clientId, connectionId, {
    ...base,
    type: 'queue-progress',
    state: 'generating',
    generationId: `flow-${base.attemptId}`,
  });
  const mediaId = randomUUID();
  mutations.checkpoint(clientId, connectionId, {
    ...base,
    type: 'queue-checkpoint',
    stage: 'image_generated',
    mediaId,
  });
  mutations.checkpoint(clientId, connectionId, {
    ...base,
    type: 'queue-checkpoint',
    stage: 'video_submitted',
    operationId: randomUUID(),
  });
  mutations.progress(clientId, connectionId, {
    ...base,
    type: 'queue-progress',
    state: 'failed',
    error: {
      code: 'flow_unsafe_generation',
      message: 'Confirmed refusal',
      retryable: false,
      notSubmitted: false,
    },
  });
  queue.control(clientId, false);
  const url = `/manage/takes/${task.id}`;
  const api = async (
    path: string,
    payload?: Record<string, unknown>,
  ): Promise<ApiReply> =>
    f.app.inject({
      method: payload === undefined ? 'GET' : 'POST',
      url: url + path,
      headers: fixture.headers,
      ...(payload === undefined ? {} : { payload }),
    });
  const draft = {
    requestId: randomUUID(),
    expectedRevision: database.task(task.id).summary.revision,
    content: {
      copy: 'Confira os detalhes do produto.',
      videoPrompt: 'Single presenter says: Confira os detalhes do produto.',
      reason: 'Revisão da fala após a recusa.',
    },
  };
  return {
    ...fixture,
    clientId,
    database,
    queue,
    mutations,
    original,
    task,
    mediaId,
    connectionId,
    api,
    draft,
  };
}

test('a revision is a durable preview and only explicit approval dispatches its video with the recorded image', async (t) => {
  const f = await refusedTake(t);
  const before = f.database.detail(f.task.id, f.clientId);
  const review = await f.api('/review');
  assert.equal(review.statusCode, 200, review.body);
  assert.equal(review.json().canPrepare, true);
  assert.ok(review.json().context.instructions.length > 0);
  const prepared = await f.api('/revisions', f.draft);
  assert.equal(prepared.statusCode, 200, prepared.body);
  const revision = prepared.json<FlowTakeRevision>();
  assert.equal(revision.approvedAt, null);
  assert.deepEqual(revision.sourceImage, {
    taskId: f.task.id,
    mediaId: f.mediaId,
  });
  assert.deepEqual((await f.api('/revisions', f.draft)).json(), revision);
  assert.equal(f.database.task(f.task.id).summary.state, 'failed');
  assert.equal(f.database.detail(f.task.id, f.clientId).attempts.length, 1);
  assert.equal(
    (
      await f.api('/revisions', {
        ...f.draft,
        content: { ...f.draft.content, copy: 'Different' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.api('/revisions/approve', {
        revisionId: revision.id,
        userAuthorized: false,
      })
    ).statusCode,
    400,
  );
  const approval = {
    revisionId: revision.id,
    userAuthorized: true,
    startQueue: true,
  };
  const approved = await f.api('/revisions/approve', approval);
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal(approved.json<FlowTakeRevision>().attemptNumber, 2);
  assert.equal((await f.api('/revisions/approve', approval)).statusCode, 200);
  const messages: QueueExecute[] = [];
  const engine = new QueueEngine(f.queue, f.mutations, {
    queueConnections: (): ReturnType<QueueTransport['queueConnections']> => [
      {
        clientId: f.clientId,
        connectionId: f.connectionId,
        flowCapable: true,
        modernFlowCapable: true,
        videoFoldersCapable: true,
        flowRetryCapable: true,
      },
    ],
    sendQueue: (_connection, message): boolean => {
      messages.push(message);
      return true;
    },
    closeQueue: (): void => {},
  });
  t.after(() => engine.stop());
  engine.wake();
  for (let round = 0; round < 100 && messages.length === 0; round++)
    await delay(5);
  const command = messages[0];
  assert.ok(command?.type === 'flow-execute');
  assert.equal(command.original.copy, f.draft.content.copy);
  assert.equal(command.original.videoPrompt, f.draft.content.videoPrompt);
  assert.equal(command.original.imagePrompt, f.original.original.imagePrompt);
  assert.equal(command.flow.approval.imageGenerations, 0);
  assert.deepEqual(command.sourceImage, revision.sourceImage);
  const after = f.database.detail(f.task.id, f.clientId);
  assert.deepEqual(after.input, before.input);
  assert.deepEqual(after.attempts[0], before.attempts[0]);
  assert.deepEqual(after.checkpoints, before.checkpoints);
  const history = new FlowRevisionStore(f.database);
  assert.deepEqual(
    history.original(f.database.task(f.task.id), 1),
    before.input.original,
  );
  assert.equal(
    history.original(f.database.task(f.task.id), 2).copy,
    f.draft.content.copy,
  );
});

test('revision approval rejects stale, closed and revoked takes while preparation rejects reused identifiers', async (t) => {
  for (const restriction of ['stale', 'closed', 'revoked'] as const) {
    await t.test(restriction, async (t) => {
      const f = await refusedTake(t);
      const prepared = await f.api('/revisions', f.draft);
      assert.equal(prepared.statusCode, 200, prepared.body);
      const revision = prepared.json<FlowTakeRevision>();
      assert.equal(
        (
          await f.api('/revisions', {
            ...f.draft,
            content: { ...f.draft.content, reason: 'Outro motivo.' },
          })
        ).statusCode,
        409,
      );
      if (restriction === 'stale')
        f.f.database
          .prepare('UPDATE queue_tasks SET revision=revision+1 WHERE id=?')
          .run(f.task.id);
      if (restriction === 'closed')
        f.f.database
          .prepare(
            'INSERT INTO dispatch_closures(dispatch_id,review_hash,preparation_hash,note,closed_at) VALUES (?,?,?,?,?)',
          )
          .run(
            f.commandId,
            'a'.repeat(64),
            'b'.repeat(64),
            'Closed fixture',
            Date.now(),
          );
      if (restriction === 'revoked')
        f.f.database
          .prepare('UPDATE clients SET revoked_at=? WHERE id=?')
          .run(Date.now(), f.clientId);
      const approved = await f.api('/revisions/approve', {
        revisionId: revision.id,
        userAuthorized: true,
      });
      assert.equal(approved.statusCode, 409, approved.body);
      assert.equal(f.database.task(f.task.id).summary.state, 'failed');
      assert.equal(
        f.f.database
          .prepare('SELECT COUNT(*) AS n FROM queue_flow_retry_authorizations')
          .get()!.n,
        0,
      );
    });
  }
});

test('a chat-authorized revision saves and queues one video atomically and repeated publication keeps one authorization', async (t) => {
  const f = await refusedTake(t);
  const before = f.database.detail(f.task.id, f.clientId);
  const rejected = await f.api('/revisions', {
    ...f.draft,
    execution: { userAuthorized: false },
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(f.database.detail(f.task.id, f.clientId).revisions.length, 0);
  const publication = { ...f.draft, execution: { userAuthorized: true } };
  const response = await f.api('/revisions', publication);
  assert.equal(response.statusCode, 200, response.body);
  const revision = response.json<FlowTakeRevision>();
  assert.ok(revision.approvedAt);
  assert.equal(revision.attemptNumber, 2);
  assert.deepEqual(revision.sourceImage, {
    taskId: f.task.id,
    mediaId: f.mediaId,
  });
  assert.equal(f.database.task(f.task.id).summary.state, 'queued');
  assert.equal(f.queue.snapshot(f.clientId).running, true);
  assert.deepEqual((await f.api('/revisions', publication)).json(), revision);
  assert.equal(
    f.f.database
      .prepare('SELECT COUNT(*) AS n FROM queue_flow_retry_authorizations')
      .get()!.n,
    1,
  );
  const active = f.queue.claim(f.task.id, f.connectionId);
  assert.ok(active?.activeAttemptId);
  assert.equal(active.summary.attemptCount, 2);
  assert.equal(
    new FlowRevisionStore(f.database).original(active).videoPrompt,
    f.draft.content.videoPrompt,
  );
  const after = f.database.detail(f.task.id, f.clientId);
  assert.deepEqual(after.input, before.input);
  assert.deepEqual(after.attempts[0], before.attempts[0]);
});

test('an existing preview can be published with the chat authorization in the same request', async (t) => {
  const f = await refusedTake(t);
  const prepared = await f.api('/revisions', f.draft);
  assert.equal(prepared.statusCode, 200, prepared.body);
  assert.equal(prepared.json<FlowTakeRevision>().approvedAt, null);
  const published = await f.api('/revisions', {
    ...f.draft,
    execution: { userAuthorized: true, startQueue: false },
  });
  assert.equal(published.statusCode, 200, published.body);
  assert.equal(
    published.json<FlowTakeRevision>().id,
    prepared.json<FlowTakeRevision>().id,
  );
  assert.ok(published.json<FlowTakeRevision>().approvedAt);
  assert.equal(f.queue.snapshot(f.clientId).running, false);
  assert.equal(f.database.task(f.task.id).summary.state, 'queued');
});

test('a failure while authorizing a combined revision rolls back both the saved version and queue changes', async (t) => {
  const f = await refusedTake(t);
  f.f.database.exec(`CREATE TRIGGER reject_fixture_revision_authorization
    BEFORE INSERT ON queue_flow_retry_authorizations BEGIN
      SELECT RAISE(ABORT, 'fixture authorization failure');
    END;`);
  const response = await f.api('/revisions', {
    ...f.draft,
    execution: { userAuthorized: true },
  });
  assert.equal(response.statusCode, 500);
  assert.equal(f.database.detail(f.task.id, f.clientId).revisions.length, 0);
  assert.equal(f.database.task(f.task.id).summary.state, 'failed');
  assert.equal(f.database.task(f.task.id).summary.attemptCount, 1);
  assert.equal(f.queue.snapshot(f.clientId).running, false);
});
