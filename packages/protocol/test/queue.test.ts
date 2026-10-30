import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  canTransitionTask,
  taskInputSchema,
  enqueueSchema,
} from '../src/index.js';

test('queue states require confirmed submission and download stage; uncertainty cannot requeue directly', () => {
  assert.equal(canTransitionTask('queued', 'completed'), false);
  assert.equal(canTransitionTask('dispatching', 'submitted'), true);
  assert.equal(canTransitionTask('generating', 'completed'), false);
  assert.equal(canTransitionTask('uncertain', 'queued'), false);
  assert.equal(canTransitionTask('uncertain', 'failed'), true);
  assert.equal(canTransitionTask('failed', 'queued'), true);
  assert.equal(canTransitionTask('completed', 'queued'), false);
});
test('queue preserves original creative bytes and rejects traversal, paid executors and duplicate keys', () => {
  const original = {
    imagePrompt: ' { "prompt": "produto" }\n',
    videoPrompt: 'original\n',
    copy: '  Hook\nBody\nCTA  ',
  };
  const task = {
    taskKey: randomUUID(),
    product: 'Produto',
    video: 'Vídeo',
    format: '9:16',
    take: 'Hook',
    references: [],
    original,
    executor: 'simulation',
    simulation: { durationMs: 100, scenario: 'success' },
  };
  assert.deepEqual(taskInputSchema.parse(task).original, original);
  for (const relativePath of [
    '../secret',
    '/etc/passwd',
    'C:\\Users\\secret',
    'nested/../secret',
    'ok//file',
  ]) {
    assert.equal(
      taskInputSchema.safeParse({
        ...task,
        references: [{ root: 'inputs', relativePath }],
      }).success,
      false,
    );
  }
  assert.equal(
    taskInputSchema.safeParse({ ...task, executor: 'google-flow' }).success,
    false,
  );
  assert.equal(
    enqueueSchema.safeParse({ requestId: randomUUID(), tasks: [task, task] })
      .success,
    false,
  );
});
