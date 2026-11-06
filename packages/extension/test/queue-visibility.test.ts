import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { taskStateSchema } from '@flow-batch/protocol';
import { clearFinishedTasks, isClearedTask } from '../src/queue-visibility.js';

test('clearing removes only completed takes, preserving pending work, failures and uncertain results', () => {
  const tasks = taskStateSchema.options.map((state) => ({
    id: randomUUID(),
    state,
    revision: 5,
  }));
  const original = structuredClone(tasks);
  const cleared = clearFinishedTasks(tasks, new Map());
  assert.deepEqual(tasks, original);
  assert.equal(cleared.size, 1);
  for (const task of tasks)
    assert.equal(isClearedTask(task, cleared), task.state === 'completed');
});

test('new tasks and new revisions stay visible; reopening starts with an empty selection', () => {
  const completed = {
    id: randomUUID(),
    state: 'completed' as const,
    revision: 5,
  };
  const cleared = clearFinishedTasks([completed], new Map());
  assert.equal(isClearedTask(completed, cleared), true);
  assert.equal(isClearedTask({ ...completed, revision: 6 }, cleared), false);
  assert.equal(
    isClearedTask({ ...completed, id: randomUUID() }, cleared),
    false,
  );
  assert.equal(isClearedTask(completed, new Map()), false);
});
