import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { z } from 'zod';
import { taskSummarySchema, type TaskInput } from '@flow-batch/protocol';
import { queueFixture } from './queue-support.js';
import { flowInput } from './flow-support.js';
import { BatchStore } from '../src/persistence/batches.js';
import { signed } from './support.js';

test('signed import enqueues atomically, survives lost confirmation and rejects changed materials with no partial insertion', async (t) => {
  const f = await queueFixture(t);
  const store = new BatchStore(f.database);
  const batchId = randomUUID(),
    projectId = randomUUID();
  store.action(f.clientId, {
    action: 'prepare',
    draft: { id: batchId, name: 'Import fixture', mode: 'existing-project' },
  });
  store.action(f.clientId, {
    action: 'attach',
    id: batchId,
    expectedRevision: 0,
    projectId,
  });
  const tasks = ['Hook', 'Body', 'CTA'].map((take) => {
    const input = flowInput();
    input.take = take;
    input.flow.batchId = batchId;
    input.flow.projectId = projectId;
    return input;
  });
  const post = async (
    requestId: string,
    inputs: TaskInput[],
  ): Promise<Awaited<ReturnType<typeof f.app.inject>>> => {
    const body = JSON.stringify({ requestId, tasks: inputs });
    const proof = await signed(f, f.clientId, 'POST', '/api/queue', body);
    return f.app.inject({
      method: 'POST',
      url: '/api/queue',
      headers: proof.headers,
      payload: body,
    });
  };
  const requestId = randomUUID();
  const first = await post(requestId, tasks);
  assert.equal(first.statusCode, 200, first.body);
  const summaries = z
    .object({ tasks: z.array(taskSummarySchema) })
    .parse(first.json()).tasks;
  assert.equal(summaries.length, 3);
  // The caller may have lost the first HTTP response. Neither retry creates new work.
  assert.deepEqual((await post(requestId, tasks)).json(), first.json());
  assert.deepEqual((await post(randomUUID(), tasks)).json(), first.json());
  assert.equal(f.repository.snapshot(f.clientId).counts.queued, 3);
  assert.equal(f.repository.snapshot(f.clientId).running, false);
  const newInput = flowInput();
  newInput.flow.batchId = batchId;
  newInput.flow.projectId = projectId;
  const changed = structuredClone(tasks[0]!);
  changed.original.copy = 'Alterada';
  assert.equal((await post(randomUUID(), [newInput, changed])).statusCode, 409);
  assert.equal(f.repository.snapshot(f.clientId).counts.queued, 3);
  assert.deepEqual(
    f.queueDatabase.detail(summaries[0]!.id, f.clientId).input.original,
    tasks[0]!.original,
  );
  const badProject = structuredClone(tasks[0]!);
  badProject.taskKey = randomUUID();
  badProject.flow.projectId = randomUUID();
  assert.equal(
    (await post(randomUUID(), [newInput, badProject])).statusCode,
    409,
  );
  assert.equal(f.repository.snapshot(f.clientId).counts.queued, 3);
});
