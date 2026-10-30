import { randomUUID } from 'node:crypto';
import { taskInputSchema, type TaskInput } from '@flow-batch/protocol';

export function flowInput(): Extract<TaskInput, { executor: 'google-flow' }> {
  const input = taskInputSchema.parse({
    taskKey: randomUUID(),
    product: 'Flow fixture',
    video: 'Video',
    take: 'Hook',
    format: '9:16',
    references: [],
    original: {
      imagePrompt: '  original __CAPTCHA__ image\n',
      videoPrompt: 'Original\nvideo',
      copy: ' copy ',
    },
    executor: 'google-flow',
    maxAttempts: 1,
    flow: {
      projectId: randomUUID(),
      imageModel: 'GEM_PIX_2',
      videoModel: 'veo_3_1_i2v_lite',
      aspect: '9:16',
      seed: 1234,
      reference: {
        assetId: randomUUID(),
        name: 'reference.png',
        mime: 'image/png',
        bytes: 100,
        sha256: 'a'.repeat(64),
      },
      approval: {
        approvedAt: Date.now(),
        imageGenerations: 1,
        videoGenerations: 1,
      },
    },
  });
  if (input.executor !== 'google-flow')
    throw new Error('Expected Flow fixture');
  return input;
}
