import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  flowSettingsSchema,
  resolveOmniVideoModel,
  type FlowSettings,
} from '@flow-batch/protocol';
import { imageRequest, videoRequest } from '../src/flow-payloads.js';

function settings(videoModel: FlowSettings['videoModel']): FlowSettings {
  return flowSettingsSchema.parse({
    projectId: randomUUID(),
    imageModel: 'GEM_PIX_2',
    videoModel,
    aspect: '9:16',
    seed: 123,
    reference: {
      assetId: randomUUID(),
      name: 'product.png',
      mime: 'image/png',
      bytes: 100,
      sha256: 'a'.repeat(64),
    },
    approval: {
      approvedAt: Date.now(),
      imageGenerations: 1,
      videoGenerations: 1,
    },
  });
}
test('Omni Frames keeps the generated image as the first frame for each supported duration, resolution and aspect', () => {
  const imageId = randomUUID();
  const prompt = '  Original __CAPTCHA__ video prompt\n';
  for (const duration of [4, 6, 8, 10])
    for (const resolution of ['720p', '360p'])
      for (const aspect of ['9:16', '16:9'] as const) {
        const flow = {
          ...settings(resolveOmniVideoModel(duration, resolution)),
          aspect,
        };
        const request = videoRequest(flow, prompt, imageId);
        assert.equal(request.rpcId, 'eb1hJf');
        assert.equal(request.captchaAction, 'VIDEO_GENERATION');
        const payload = request.payload as unknown[][];
        const item = payload[0]?.[0] as unknown[];
        assert.deepEqual(item[0], [null, null, [[[prompt]]]]);
        assert.equal(
          item[1],
          `abra_i2v_${duration}s${resolution === '360p' ? '_360p' : ''}`,
        );
        assert.equal(item[2], aspect === '9:16' ? 1 : 2);
        assert.equal(item[3], null);
        assert.deepEqual(item[4], [
          null,
          imageId,
          null,
          null,
          null,
          [null, null, 1, 1],
        ]);
        assert.equal(item.length, resolution === '360p' ? 10 : 6);
        if (resolution === '360p')
          assert.deepEqual(item.slice(6), [null, null, null, [4]]);
        assert.deepEqual(payload[1]?.[10], [null, 1]);
        assert.equal(payload[1]?.[5], flow.projectId);
      }
});
test('Veo payloads remain unchanged and both Nano Banana models keep reference conditioning', () => {
  const flow = settings('veo_3_1_i2v_lite');
  const imageId = randomUUID();
  const item = (
    videoRequest(flow, 'Video', imageId).payload[0] as unknown[][]
  )[0];
  assert.equal(item?.[1], 'veo_3_1_i2v_lite');
  assert.equal(item?.length, 6);
  for (const imageModel of ['GEM_PIX_2', 'BELUGA'] as const) {
    const request = imageRequest(
      { ...flow, imageModel },
      'Original image',
      imageId,
    );
    const image = (request.payload[1] as unknown[][])[0];
    assert.equal(image?.[5], imageModel);
    assert.deepEqual(image?.[2], [[imageId, null, null, null, 1]]);
  }
});
