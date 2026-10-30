import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  flowSettingsSchema,
  taskInputSchema,
  queueResultSchema,
  popupRequestSchema,
} from '../src/index.js';

test('Flow inputs bind approval to one image, one video, supported models and an immutable local reference', () => {
  const settings = {
    projectId: randomUUID(),
    imageModel: 'GEM_PIX_2',
    videoModel: 'veo_3_1_i2v_lite',
    aspect: '9:16',
    seed: 1,
    reference: {
      assetId: randomUUID(),
      name: 'original.png',
      mime: 'image/png',
      bytes: 12,
      sha256: 'a'.repeat(64),
    },
    approval: {
      approvedAt: Date.now(),
      imageGenerations: 1,
      videoGenerations: 1,
    },
  };
  assert.equal(flowSettingsSchema.safeParse(settings).success, true);
  assert.equal(
    flowSettingsSchema.safeParse({ ...settings, approval: undefined }).success,
    false,
  );
  assert.equal(
    flowSettingsSchema.safeParse({
      ...settings,
      approval: { ...settings.approval, imageGenerations: 2 },
    }).success,
    false,
  );
  assert.equal(
    flowSettingsSchema.safeParse({
      ...settings,
      reference: { ...settings.reference, base64: 'secret' },
    }).success,
    false,
  );
  assert.equal(
    flowSettingsSchema.safeParse({ ...settings, videoModel: 'arbitrary' })
      .success,
    false,
  );
  const task = {
    taskKey: randomUUID(),
    product: 'Product',
    video: 'Video',
    take: 'Hook',
    format: '9:16',
    references: [],
    original: {
      imagePrompt: ' {"prompt":"__CAPTCHA__"}\n ',
      videoPrompt: ' original video ',
      copy: '',
    },
    executor: 'google-flow',
    flow: settings,
    maxAttempts: 1,
  };
  assert.deepEqual(taskInputSchema.parse(task).original, task.original);
  assert.equal(
    taskInputSchema.safeParse({ ...task, maxAttempts: 2 }).success,
    false,
  );
  assert.equal(
    taskInputSchema.safeParse({ ...task, format: '16:9' }).success,
    false,
  );
  assert.equal(
    taskInputSchema.safeParse({
      ...task,
      original: { ...task.original, imagePrompt: ' ' },
    }).success,
    false,
  );
  assert.equal(
    queueResultSchema.safeParse({
      simulated: false,
      outputFile: 'C:\\secret.mp4',
      description: 'Complete',
    }).success,
    false,
  );
  assert.equal(
    popupRequestSchema.safeParse({ type: 'enqueue-flow' }).success,
    false,
  );
});
