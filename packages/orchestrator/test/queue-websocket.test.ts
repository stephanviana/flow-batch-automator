import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import {
  serverMessageSchema,
  type QueueExecute,
  type TaskSummary,
  type QueueSnapshot,
} from '@flow-batch/protocol';
import { fixture, pair, approve, signed, type Fixture } from './support.js';
import { taskInput, progress } from './queue-support.js';

test('revocation interrupts queued execution and reauthorization does not resend it', async (t) => {
  const f = await fixture(t);
  const receipt = await pair(f);
  const management = await approve(f, receipt);
  const socket = await socketFor(f, receipt.clientId, 3);
  t.after(() => socket.terminate());
  await queueRequest(f, receipt.clientId, '/api/queue', {
    requestId: randomUUID(),
    tasks: [taskInput()],
  });
  await queueRequest(f, receipt.clientId, '/api/queue/control', {
    action: 'start',
  });
  await eventually(
    () =>
      f.database
        .prepare(
          "SELECT COUNT(*) AS count FROM queue_tasks WHERE state='dispatching'",
        )
        .get()?.count === 1,
  );
  const closed = once(socket, 'close');
  await f.app.inject({
    method: 'POST',
    url: `/manage/clients/${receipt.clientId}/revoke`,
    headers: management,
    payload: {},
  });
  assert.equal((await closed)[0], 4003);
  assert.equal(
    f.database.prepare('SELECT state FROM queue_tasks').get()?.state,
    'uncertain',
  );
  const fresh = await pair(f);
  assert.equal(fresh.clientId, receipt.clientId);
  await approve(f, fresh);
  const reconnected = await socketFor(f, fresh.clientId, 3);
  t.after(() => reconnected.terminate());
  const snapshot = (
    await queueRequest(f, fresh.clientId, '/api/queue')
  ).json<QueueSnapshot>();
  assert.equal(snapshot.blockedByReview, true);
  assert.equal(snapshot.running, false);
  assert.equal(snapshot.tasks[0]?.attemptCount, 1);
});

async function socketFor(
  f: Fixture,
  clientId: string,
  version?: 3,
): Promise<WebSocket> {
  if (!f.app.server.listening)
    await f.app.listen({ host: '127.0.0.1', port: 0 });
  const address = f.app.server.address();
  assert.ok(address && typeof address !== 'string');
  const proof = await signed(f, clientId, 'GET', '/ws');
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
    headers: {
      host: f.headers.host,
      origin: `chrome-extension://${f.extensionId}`,
    },
  });
  await once(socket, 'open');
  const authenticated = once(socket, 'message');
  socket.send(
    JSON.stringify({
      type: 'authenticate',
      clientId,
      challengeId: proof.challenge.challengeId,
      signature: proof.signature,
      ...(version ? { protocolVersion: version } : {}),
    }),
  );
  assert.deepEqual(
    serverMessageSchema.parse(JSON.parse(String((await authenticated)[0]))),
    { type: 'authenticated' },
  );
  return socket;
}
async function queueRequest(
  f: Fixture,
  clientId: string,
  target:
    | '/api/queue'
    | '/api/queue/control'
    | '/api/queue/actions'
    | '/api/queue/task',
  payload?: unknown,
): Promise<Awaited<ReturnType<Fixture['app']['inject']>>> {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const method = payload === undefined ? 'GET' : 'POST';
  const proof = await signed(f, clientId, method, target, body);
  return f.app.inject({
    method,
    url: target,
    headers: proof.headers,
    ...(payload === undefined ? {} : { payload: body }),
  });
}
async function eventually(
  check: () => boolean | Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(10);
  }
  assert.fail('Queue integration condition timed out');
}
function job(raw: unknown): QueueExecute {
  const message = serverMessageSchema.parse(JSON.parse(String(raw)));
  assert.equal(message.type, 'queue-execute');
  if (message.type !== 'queue-execute')
    throw new Error('Expected queue dispatch');
  return message;
}

test('authenticated queue runs an ordered batch one task at a time and pause prevents the next dispatch', async (t) => {
  const f = await fixture(t);
  const receipt = await pair(f);
  await approve(f, receipt);
  const socket = await socketFor(f, receipt.clientId, 3);
  t.after(() => socket.terminate());
  const jobs: QueueExecute[] = [];
  socket.on('message', (raw): void => {
    jobs.push(job(raw));
  });
  const created = await queueRequest(f, receipt.clientId, '/api/queue', {
    requestId: randomUUID(),
    tasks: [
      taskInput(),
      taskInput({ take: 'Body' }),
      taskInput({ take: 'CTA' }),
    ],
  });
  assert.equal(created.statusCode, 200);
  const tasks = created.json<{ tasks: TaskSummary[] }>().tasks;
  await delay(30);
  assert.equal(jobs.length, 0);
  assert.equal(
    (
      await queueRequest(f, receipt.clientId, '/api/queue/control', {
        action: 'start',
      })
    ).statusCode,
    200,
  );
  await eventually(() => jobs.length === 1);
  assert.equal(jobs[0]?.taskId, tasks[0]?.id);
  await queueRequest(f, receipt.clientId, '/api/queue/control', {
    action: 'pause',
  });
  for (const state of [
    'submitted',
    'generating',
    'download_pending',
    'completed',
  ] as const)
    socket.send(
      JSON.stringify(progress(jobs[0]!.taskId, jobs[0]!.attemptId, state)),
    );
  await delay(50);
  assert.equal(jobs.length, 1);
  await queueRequest(f, receipt.clientId, '/api/queue/control', {
    action: 'start',
  });
  await eventually(() => jobs.length === 2);
  for (const state of [
    'submitted',
    'generating',
    'download_pending',
    'completed',
  ] as const)
    socket.send(
      JSON.stringify(progress(jobs[1]!.taskId, jobs[1]!.attemptId, state)),
    );
  await eventually(() => jobs.length === 3);
  assert.equal(jobs[2]?.taskId, tasks[2]?.id);
  for (const state of [
    'submitted',
    'generating',
    'download_pending',
    'completed',
  ] as const)
    socket.send(
      JSON.stringify(progress(jobs[2]!.taskId, jobs[2]!.attemptId, state)),
    );
  await eventually(
    async () =>
      (
        await queueRequest(f, receipt.clientId, '/api/queue')
      ).json<QueueSnapshot>().counts.completed === 3,
  );
  const trace = f.database
    .prepare(
      "SELECT task_id,state FROM queue_events WHERE state IN ('dispatching','completed') ORDER BY sequence",
    )
    .all();
  assert.deepEqual(
    trace.map((row) => row.state),
    [
      'dispatching',
      'completed',
      'dispatching',
      'completed',
      'dispatching',
      'completed',
    ],
  );
});

test('disconnect and timeout fence attempts as uncertain, preserve pending tasks and do not resend on reconnect', async (t) => {
  const f = await fixture(t);
  const receipt = await pair(f);
  await approve(f, receipt);
  let socket = await socketFor(f, receipt.clientId, 3);
  t.after(() => socket.terminate());
  const messages: QueueExecute[] = [];
  socket.on('message', (raw): void => {
    messages.push(job(raw));
  });
  const response = await queueRequest(f, receipt.clientId, '/api/queue', {
    requestId: randomUUID(),
    tasks: [taskInput(), taskInput()],
  });
  const tasks = response.json<{ tasks: TaskSummary[] }>().tasks;
  assert.ok(tasks[0] && tasks[1]);
  await queueRequest(f, receipt.clientId, '/api/queue/control', {
    action: 'start',
  });
  await eventually(() => messages.length === 1);
  const first = messages[0]!;
  socket.send(
    JSON.stringify(progress(first.taskId, first.attemptId, 'submitted')),
  );
  await delay(20);
  const closed = once(socket, 'close');
  socket.close();
  await closed;
  await eventually(
    () =>
      f.database
        .prepare('SELECT state FROM queue_tasks WHERE id=?')
        .get(first.taskId)?.state === 'uncertain',
  );
  socket = await socketFor(f, receipt.clientId, 3);
  socket.on('message', (raw): void => {
    messages.push(job(raw));
  });
  await delay(40);
  assert.equal(messages.length, 1);
  assert.equal(
    (
      await queueRequest(f, receipt.clientId, '/api/queue/control', {
        action: 'start',
      })
    ).statusCode,
    409,
  );
  let snapshot = (
    await queueRequest(f, receipt.clientId, '/api/queue')
  ).json<QueueSnapshot>();
  const uncertain = snapshot.tasks.find((task) => task.id === first.taskId)!;
  await queueRequest(f, receipt.clientId, '/api/queue/actions', {
    action: 'resolve',
    requestId: randomUUID(),
    taskId: uncertain.id,
    expectedRevision: uncertain.revision,
    outcome: 'not_submitted',
    note: 'Simulation reviewed',
  });
  await queueRequest(f, receipt.clientId, '/api/queue/control', {
    action: 'start',
  });
  await eventually(() => messages.length === 2);
  assert.equal(messages[1]?.taskId, tasks[1].id);
  // Simulate an expired persisted deadline, not elapsed wall time in the runner.
  f.database
    .prepare('UPDATE queue_tasks SET deadline_at=0 WHERE id=?')
    .run(tasks[1].id);
  const expired = once(socket, 'close');
  await queueRequest(f, receipt.clientId, '/api/queue/control', {
    action: 'start',
  });
  await expired;
  snapshot = (
    await queueRequest(f, receipt.clientId, '/api/queue')
  ).json<QueueSnapshot>();
  assert.equal(snapshot.blockedByReview, true);
  assert.equal(
    snapshot.tasks.find((task) => task.id === tasks[1]?.id)?.state,
    'uncertain',
  );
  assert.equal(
    f.database.prepare('SELECT COUNT(*) AS count FROM queue_attempts').get()
      ?.count,
    2,
  );
});

test('offline enqueue persists and v2 clients cannot receive queue work until capability is negotiated', async (t) => {
  const f = await fixture(t);
  const receipt = await pair(f);
  await approve(f, receipt);
  const request = { requestId: randomUUID(), tasks: [taskInput()] };
  const created = await queueRequest(
    f,
    receipt.clientId,
    '/api/queue',
    request,
  );
  assert.equal(created.statusCode, 200);
  const id = created.json<{ tasks: TaskSummary[] }>().tasks[0]!.id;
  await queueRequest(f, receipt.clientId, '/api/queue/control', {
    action: 'start',
  });
  const old = await socketFor(f, receipt.clientId);
  const received: unknown[] = [];
  old.on('message', (message) => {
    received.push(message);
  });
  await delay(50);
  assert.equal(received.length, 0);
  assert.equal(
    f.database.prepare('SELECT state FROM queue_tasks WHERE id=?').get(id)
      ?.state,
    'queued',
  );
  const closed = once(old, 'close');
  old.close();
  await closed;
  const current = await socketFor(f, receipt.clientId, 3);
  t.after(() => current.terminate());
  await eventually(
    () =>
      f.database.prepare('SELECT state FROM queue_tasks WHERE id=?').get(id)
        ?.state === 'dispatching',
  );
  const proof = await signed(
    f,
    receipt.clientId,
    'POST',
    '/api/queue/task',
    JSON.stringify({ taskId: id }),
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/queue/task',
        headers: proof.headers,
        payload: JSON.stringify({ taskId: randomUUID() }),
      })
    ).statusCode,
    401,
  );
});
