import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readinessSchema, popupRequestSchema } from '../src/index.js';

test('health rejects inconsistent state and accidental internal details', () => {
  assert.equal(
    readinessSchema.safeParse({ status: 'ready', sqlite: 'unavailable' })
      .success,
    false,
  );
  assert.equal(
    readinessSchema.safeParse({
      status: 'ready',
      sqlite: 'available',
      path: '/data/private.sqlite',
    }).success,
    false,
  );
});

test('popup messages cannot select arbitrary URLs or browser actions', () => {
  assert.equal(popupRequestSchema.safeParse({ type: 'status' }).success, true);
  assert.equal(
    popupRequestSchema.safeParse({
      type: 'status',
      url: 'https://example.com',
    }).success,
    false,
  );
  assert.equal(
    popupRequestSchema.safeParse({ type: 'generate' }).success,
    false,
  );
});
