import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  flowSettingsSchema,
  queueCheckpointSchema,
  flowExecuteSchema,
} from '../src/flow.js';

function settings(): Record<string, unknown> {
  return {
    projectId: randomUUID(),
    imageModel: 'GEM_PIX_2',
    videoModel: 'abra_i2v_8s',
    aspect: '9:16',
    seed: 42,
    reference: {
      assetId: randomUUID(),
      name: 'product.png',
      mime: 'image/png',
      bytes: 12,
      sha256: 'a'.repeat(64),
    },
    approval: { approvedAt: 1, imageGenerations: 1, videoGenerations: 1 },
  };
}

test('legacy seeds remain required and browser takes explicitly bind UI randomness and credit cap', () => {
  const legacy = settings();
  assert.deepEqual(flowSettingsSchema.parse(legacy), legacy);
  assert.equal(
    flowSettingsSchema.safeParse({ ...legacy, seed: null }).success,
    false,
  );
  assert.equal(
    flowSettingsSchema.safeParse({ ...legacy, driver: 'browser-ui' }).success,
    false,
  );
  assert.equal(
    flowSettingsSchema.safeParse({
      ...legacy,
      driver: 'browser-ui',
      seed: null,
    }).success,
    false,
  );
  const native = {
    ...legacy,
    driver: 'browser-ui',
    seed: null,
    maxVideoCredits: 25,
  };
  assert.equal(flowSettingsSchema.safeParse(native).success, true);
  assert.equal(
    flowSettingsSchema.safeParse({ ...legacy, maxVideoCredits: 25 }).success,
    false,
  );
  assert.equal(
    flowExecuteSchema.safeParse({
      type: 'flow-execute',
      taskId: randomUUID(),
      attemptId: randomUUID(),
      attemptNumber: 1,
      flow: native,
      original: {
        imagePrompt: 'Prepared image',
        videoPrompt: 'Prepared video',
        copy: 'Prepared copy',
      },
    }).success,
    true,
  );
});

test('download checkpoint preserves numeric extension IDs and supports native Chrome GUIDs', () => {
  const base = {
    type: 'queue-checkpoint',
    stage: 'download_started',
    taskId: randomUUID(),
    attemptId: randomUUID(),
  };
  assert.equal(
    queueCheckpointSchema.safeParse({ ...base, downloadId: 42 }).success,
    true,
  );
  assert.equal(
    queueCheckpointSchema.safeParse({ ...base, downloadId: randomUUID() })
      .success,
    true,
  );
  assert.equal(
    queueCheckpointSchema.safeParse({ ...base, downloadId: 'unconfirmed' })
      .success,
    false,
  );
});
