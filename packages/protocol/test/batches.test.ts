import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { batchActionSchema, popupRequestSchema } from '../src/index.js';

test('batch commands require recorded IDs, review revision and a bounded draft', () => {
  const id = randomUUID();
  assert.equal(
    popupRequestSchema.safeParse({ type: 'batch-open' }).success,
    false,
  );
  assert.equal(
    popupRequestSchema.safeParse({ type: 'batch-open', batchId: id }).success,
    true,
  );
  assert.equal(
    popupRequestSchema.safeParse({ type: 'batch-attach', batchId: id }).success,
    false,
  );
  assert.equal(
    popupRequestSchema.safeParse({
      type: 'batch-attach',
      batchId: id,
      expectedRevision: 1,
    }).success,
    true,
  );
  assert.equal(
    batchActionSchema.safeParse({
      action: 'prepare',
      draft: { id, name: ' ', mode: 'new-project' },
    }).success,
    false,
  );
  assert.equal(
    batchActionSchema.safeParse({
      action: 'settle',
      id,
      attemptId: randomUUID(),
      outcome: 'ready',
    }).success,
    false,
  );
  assert.equal(
    batchActionSchema.safeParse({
      action: 'attach',
      id,
      expectedRevision: 0,
      projectId: 'https://example.com',
    }).success,
    false,
  );
});
