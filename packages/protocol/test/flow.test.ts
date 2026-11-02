import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  flowSettingsSchema,
  taskInputSchema,
  queueResultSchema,
  popupRequestSchema,
  resolveOmniVideoModel,
  flowDraftSchema,
  flowExecuteSchema,
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
  const reused = {
    ...settings,
    imageSourceTaskKey: randomUUID(),
    approval: { ...settings.approval, imageGenerations: 0 },
  };
  assert.equal(flowSettingsSchema.safeParse(reused).success, true);
  assert.equal(
    flowSettingsSchema.safeParse({ ...settings, approval: reused.approval })
      .success,
    false,
  );
  assert.equal(
    flowSettingsSchema.safeParse({ ...reused, approval: settings.approval })
      .success,
    false,
  );
  const command = {
    type: 'flow-execute',
    taskId: randomUUID(),
    attemptId: randomUUID(),
    attemptNumber: 1,
    original: { imagePrompt: 'image', videoPrompt: 'video', copy: '' },
    flow: reused,
  };
  assert.equal(flowExecuteSchema.safeParse(command).success, false);
  assert.equal(
    flowExecuteSchema.safeParse({
      ...command,
      sourceImage: { taskId: randomUUID(), mediaId: randomUUID() },
    }).success,
    true,
  );
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

test('Omni Frames accepts only supported model encodings and preserves existing Veo records', () => {
  const reference = {
    assetId: randomUUID(),
    name: 'original.png',
    mime: 'image/png',
    bytes: 12,
    sha256: 'a'.repeat(64),
  };
  const settings = {
    projectId: randomUUID(),
    imageModel: 'GEM_PIX_2',
    videoModel: 'veo_3_1_i2v_lite',
    aspect: '9:16',
    seed: 1,
    reference,
    approval: {
      approvedAt: Date.now(),
      imageGenerations: 1,
      videoGenerations: 1,
    },
  };
  assert.deepEqual(flowSettingsSchema.parse(settings), settings);
  for (const duration of [4, 6, 8, 10])
    for (const resolution of ['360p', '720p']) {
      assert.equal(
        flowSettingsSchema.parse({
          ...settings,
          videoModel: resolveOmniVideoModel(duration, resolution),
        }).videoModel,
        `abra_i2v_${duration}s${resolution === '360p' ? '_360p' : ''}`,
      );
    }
  for (const duration of [0, 5, 12, '8'])
    assert.throws(() => resolveOmniVideoModel(duration, '720p'));
  assert.throws(() => resolveOmniVideoModel(8, '1080p'));
  assert.equal(
    flowSettingsSchema.safeParse({ ...settings, videoModel: 'abra_r2v_8s' })
      .success,
    false,
  );
  const draft = {
    ...settings,
    requestId: randomUUID(),
    taskKey: randomUUID(),
    product: 'Product',
    video: 'Video',
    take: 'Hook',
    original: { imagePrompt: 'Image', videoPrompt: 'Video', copy: '' },
    reference: { name: 'original.png', mime: 'image/png', base64: 'AAAA' },
  };
  for (const imageModel of ['GEM_PIX_2', 'BELUGA'])
    assert.equal(
      flowDraftSchema.safeParse({ ...draft, imageModel }).success,
      true,
    );
  assert.equal(
    flowDraftSchema.safeParse({ ...draft, imageModel: 'HARBOR_SEAL' }).success,
    false,
  );
  // Historical Lite tasks still deserialize; the new form offers Pro and 2.1.
  assert.equal(
    flowSettingsSchema.safeParse({ ...settings, imageModel: 'HARBOR_SEAL' })
      .success,
    true,
  );
});
