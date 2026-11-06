import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { popupReplySchema, popupRequestSchema } from '../src/connection.js';

test('older worker replies remain readable when they have no dispatch review list', () => {
  const reply = popupReplySchema.parse({
    state: { phase: 'connected', message: 'Connected' },
    simulations: [],
    queue: null,
    inspection: null,
    operationError: null,
    flow: null,
  });
  assert.deepEqual(reply.dispatchIssues, []);
});

test('review navigation validates dispatch identity and rejects URL-like values', () => {
  const dispatchId = randomUUID();
  assert.equal(
    popupRequestSchema.parse({ type: 'orders-open', dispatchId }).dispatchId,
    dispatchId,
  );
  assert.equal(
    popupRequestSchema.safeParse({
      type: 'orders-open',
      dispatchId: 'https://example.com',
    }).success,
    false,
  );
  assert.equal(
    popupRequestSchema.safeParse({
      type: 'orders-open',
      dispatchId,
      url: 'https://example.com',
    }).success,
    false,
  );
});
