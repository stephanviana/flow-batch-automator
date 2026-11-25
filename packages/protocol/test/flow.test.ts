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
  readFlowPayload,
  cdnUrl,
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
      attemptNumber: 2,
      sourceImage: { taskId: randomUUID(), mediaId: randomUUID() },
    }).success,
    true,
  );
  const videoOnlyRetry = {
    ...command,
    attemptNumber: 2,
    flow: { ...settings, approval: reused.approval },
    sourceImage: { taskId: command.taskId, mediaId: randomUUID() },
  };
  assert.equal(flowExecuteSchema.safeParse(videoOnlyRetry).success, true);
  for (const invalid of [
    { ...videoOnlyRetry, attemptNumber: 1 },
    { ...videoOnlyRetry, flow: settings },
    { ...videoOnlyRetry, sourceImage: undefined },
    {
      ...videoOnlyRetry,
      sourceImage: { ...videoOnlyRetry.sourceImage, taskId: randomUUID() },
    },
  ]) {
    assert.equal(flowExecuteSchema.safeParse(invalid).success, false);
  }
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

test('Flow RPC parser accepts lh3/flow ASB asset URLs alongside legacy flow-content URLs', () => {
  const projectId = randomUUID();
  const operationId = randomUUID();
  const mediaId = randomUUID();
  const asbToken = 'ANqvLOY_token-123';
  const asbUrl = `https://lh3.googleusercontent.com/asb/${asbToken}`;
  const clip = Array<unknown>(10).fill(null);
  clip[8] = asbUrl;
  const details = Array<unknown>(10).fill(null);
  details[5] = asbUrl;
  details[8] = [3];
  const record = [
    operationId,
    projectId,
    mediaId,
    null,
    null,
    details,
    null,
    [clip],
  ];

  const reply = readFlowPayload(
    { rpcId: 'Zzl0ze', projectId, operationId, payload: [] },
    [[], [], [record]],
  );
  assert.equal(reply.ok, true);
  if (reply.ok) {
    assert.equal(reply.value.operationId, operationId);
    assert.equal(reply.value.mediaId, mediaId);
    assert.equal(reply.value.videoUrl, asbUrl);
  }

  assert.equal(
    cdnUrl(`https://flow.google.com/asb/${asbToken}=mm,22,15`, 'video'),
    `https://flow.google.com/asb/${asbToken}=mm,22,15`,
  );
  assert.equal(
    cdnUrl(
      `https://flow-content.google/image/${mediaId}?Expires=1795659002&Signature=sig`,
      'image',
    ),
    `https://flow-content.google/image/${mediaId}?Expires=1795659002&Signature=sig`,
  );
  assert.equal(cdnUrl(`${asbUrl}?token=bad`, 'video'), null);
  assert.equal(cdnUrl('https://evil.example/asb/token', 'video'), null);

  const signedImgDetails = Array<unknown>(14).fill(null);
  signedImgDetails[13] = `https://flow-content.google/image/${mediaId}?Expires=1795659002&Signature=sig`;
  const signedImgReply = readFlowPayload(
    { rpcId: 'ogiZ0b', projectId, payload: [] },
    [
      [
        [
          mediaId,
          null,
          operationId,
          null,
          null,
          null,
          [signedImgDetails, null, [756, 1344]],
        ],
      ],
      [[operationId, null, null, ['Image', [1, 0]], projectId]],
    ],
  );
  assert.deepEqual(signedImgReply, { ok: true, value: { mediaId } });

  const asbImgDetails = Array<unknown>(14).fill(null);
  asbImgDetails[13] = asbUrl;
  const unscopedAsbReply = readFlowPayload(
    { rpcId: 'ogiZ0b', projectId, payload: [] },
    [
      [
        [
          mediaId,
          null,
          operationId,
          null,
          null,
          null,
          [asbImgDetails, null, null],
        ],
      ],
      [],
    ],
  );
  assert.deepEqual(unscopedAsbReply, { ok: true, value: { mediaId } });

  const foreignAsbReply = readFlowPayload(
    { rpcId: 'ogiZ0b', projectId, payload: [] },
    [
      [
        [
          mediaId,
          randomUUID(),
          operationId,
          null,
          null,
          null,
          [asbImgDetails, null, [756, 1344]],
        ],
      ],
      [],
    ],
  );
  assert.equal(foreignAsbReply.ok, false);
});
