import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { BROWSER_EXECUTOR_ID, taskInputSchema } from '@flow-batch/protocol';
import { fixture } from './support.js';
import { flowInput } from './flow-support.js';

type TestFixture = Awaited<ReturnType<typeof fixture>>;

async function openManageSession(
  f: TestFixture,
): Promise<Record<string, string>> {
  const page = await f.app.inject({
    method: 'GET',
    url: '/orders',
    headers: { host: f.headers.host },
  });
  assert.equal(page.statusCode, 200);
  const cookie = String(page.headers['set-cookie']).split(';')[0]!;
  return {
    host: f.headers.host,
    origin: `http://${f.headers.host}`,
    cookie,
    'x-flow-management': '1',
  };
}

async function authorizeBrowserClient(
  f: TestFixture,
  manageHeaders: Record<string, string>,
): Promise<string> {
  const pair = await f.app.inject({
    method: 'POST',
    url: '/api/pairing',
    headers: { host: f.headers.host, 'x-flow-executor': BROWSER_EXECUTOR_ID },
    payload: { publicKey: f.publicKey },
  });
  assert.equal(pair.statusCode, 200);
  const { requestId, clientId } = pair.json() as {
    requestId: string;
    clientId: string;
  };
  const decided = await f.app.inject({
    method: 'POST',
    url: `/manage/requests/${requestId}`,
    headers: manageHeaders,
    payload: { approve: true },
  });
  assert.equal(decided.statusCode, 200);
  return clientId;
}

test('executor management controls queue and diagnostics resolve/cancel unblock uncertain tasks', async (t) => {
  const f = await fixture(t);
  const manageHeaders = await openManageSession(f);
  const initial = await f.app.inject({
    method: 'GET',
    url: '/manage/executor',
    headers: manageHeaders,
  });
  assert.equal(initial.statusCode, 200);
  assert.deepEqual(initial.json(), {
    executor: null,
    blockedByReview: false,
    counts: {
      queued: 0,
      active: 0,
      uncertain: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    },
  });

  const clientId = await authorizeBrowserClient(f, manageHeaders);
  const started = await f.app.inject({
    method: 'POST',
    url: '/manage/executor/control',
    headers: manageHeaders,
    payload: { action: 'start' },
  });
  assert.equal(started.statusCode, 200);
  assert.equal(started.json().executor.id, clientId);
  assert.equal(started.json().executor.running, true);

  const paused = await f.app.inject({
    method: 'POST',
    url: '/manage/executor/control',
    headers: manageHeaders,
    payload: { action: 'pause' },
  });
  assert.equal(paused.statusCode, 200);
  assert.equal(paused.json().executor.running, false);

  const materialRes = await f.app.inject({
    method: 'POST',
    url: '/manage/materials',
    headers: {
      ...manageHeaders,
      'content-type': 'application/octet-stream',
      'x-flow-filename': 'ref.png',
    },
    payload: readFileSync(resolve('../../scripts/fixtures/reference.png')),
  });
  assert.equal(materialRes.statusCode, 200);
  const material = materialRes.json() as { id: string };

  const orderRes = await f.app.inject({
    method: 'POST',
    url: '/manage/orders',
    headers: manageHeaders,
    payload: {
      id: randomUUID(),
      name: 'Teste executor',
      products: [
        {
          id: randomUUID(),
          name: 'Produto A',
          information: '',
          materials: [material.id],
          referenceId: material.id,
          groups: [{ id: randomUUID(), format: 'factory', count: 1 }],
        },
      ],
    },
  });
  assert.equal(orderRes.statusCode, 200);
  const order = orderRes.json() as { id: string; number: number };
  const batchId = randomUUID();
  const dispatchId = randomUUID();
  const baseFlow = flowInput().flow;
  const projectId = baseFlow.projectId;
  const now = Date.now();
  f.database
    .prepare(
      "INSERT INTO flow_batches (client_id,id,name,mode,project_id,status,revision,created_at,updated_at) VALUES (?,?,?,'existing',?,?,?,?,?)",
    )
    .run(clientId, batchId, 'Batch', projectId, 'ready', 1, now, now);
  f.database
    .prepare(
      "INSERT INTO dispatch_commands (id,client_id,body,body_hash,state,message,created_at) VALUES (?,?,?,?,'queued','',?)",
    )
    .run(dispatchId, clientId, '{}', 'h0', now);
  f.database
    .prepare(
      'INSERT INTO order_dispatches (order_id,dispatch_id,batch_id) VALUES (?,?,?)',
    )
    .run(order.id, dispatchId, batchId);

  const uncertainId = randomUUID();
  const queuedId = randomUUID();
  const makeInput = (take: string): string =>
    JSON.stringify(
      taskInputSchema.parse({
        taskKey: randomUUID(),
        product: 'Produto A',
        video: 'factory 1',
        format: '9:16',
        take,
        references: [],
        original: {
          imagePrompt:
            '{"prompt":"a","negative_prompt":"b","aspect_ratio":"9:16"}',
          videoPrompt: 'c',
          copy: 'd',
        },
        executor: 'google-flow',
        flow: {
          ...baseFlow,
          driver: 'browser-ui',
          seed: null,
          maxVideoCredits: 25,
        },
      }),
    );
  f.database
    .prepare(
      "INSERT INTO queue_tasks (id,client_id,task_key,input,input_hash,state,max_attempts,created_at,updated_at,next_attempt_at,batch_id) VALUES (?,?,?,?,?,'uncertain',1,?,?,?,?)",
    )
    .run(
      uncertainId,
      clientId,
      randomUUID(),
      makeInput('01-Gancho'),
      'h1',
      now,
      now,
      now,
      batchId,
    );
  f.database
    .prepare(
      "INSERT INTO queue_tasks (id,client_id,task_key,input,input_hash,state,max_attempts,created_at,updated_at,next_attempt_at,batch_id) VALUES (?,?,?,?,?,'queued',1,?,?,?,?)",
    )
    .run(
      queuedId,
      clientId,
      randomUUID(),
      makeInput('02-Body'),
      'h2',
      now,
      now,
      now,
      batchId,
    );

  const blockedStart = await f.app.inject({
    method: 'POST',
    url: '/manage/executor/control',
    headers: manageHeaders,
    payload: { action: 'start' },
  });
  assert.equal(blockedStart.statusCode, 409);

  const resolved = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.number}/diagnostics/resolve`,
    headers: manageHeaders,
    payload: {
      taskId: uncertainId,
      expectedRevision: 0,
      outcome: 'failed',
    },
  });
  assert.equal(resolved.statusCode, 200);
  assert.equal(resolved.json().task.state, 'failed');

  const cancelled = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.number}/diagnostics/cancel`,
    headers: manageHeaders,
    payload: {
      taskId: queuedId,
      expectedRevision: 0,
    },
  });
  assert.equal(cancelled.statusCode, 200);
  assert.equal(cancelled.json().task.state, 'cancelled');

  const unblocked = await f.app.inject({
    method: 'POST',
    url: '/manage/executor/control',
    headers: manageHeaders,
    payload: { action: 'start' },
  });
  assert.equal(unblocked.statusCode, 200);
  assert.equal(unblocked.json().blockedByReview, false);
  assert.equal(unblocked.json().executor.running, true);
});
