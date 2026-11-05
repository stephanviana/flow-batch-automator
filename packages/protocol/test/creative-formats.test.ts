import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { instructions } from './instruction-fixture.js';
const { animationTemplates } = instructions;
import { test } from 'node:test';
import {
  compilePreparation,
  preparationSchema,
  importImageCount,
} from '../src/index.js';

for (const format of [
  'factory',
  'factory-inclined',
  'pov',
  'full-pov',
  'seller',
] as const) {
  test(`${format} compiles exact speech with its required image sources`, async () => {
    const singleImage = format === 'full-pov' || format === 'seller';
    const hookImage = {
      prompt: 'Static hook product reference.',
      negative_prompt: 'No graphics or interface.',
      aspect_ratio: '9:16',
    };
    const presenterImage = {
      ...hookImage,
      prompt: 'Static presenter and complete product on the fixed counter.',
    };
    const copy = {
      hook: 'Fala literal do gancho.',
      body: 'Fala literal do Body.',
      cta: 'Fala literal do CTA.',
    };
    const manifest = await compilePreparation(
      {
        version: 1,
        id: randomUUID(),
        product: 'Produto de fixture',
        reference: 'reference.png',
        variations: [
          {
            id: randomUUID(),
            name: 'Variação de fixture',
            format,
            hookImage,
            ...(!singleImage ? { presenterImage } : {}),
            copy,
          },
        ],
      },
      animationTemplates,
    );

    assert.equal(manifest.tasks.length, 3);
    for (const [index, stage] of (['hook', 'body', 'cta'] as const).entries()) {
      const task = manifest.tasks[index]!;
      const prompt = task.original.videoPrompt;
      assert.equal(task.original.copy, copy[stage]);
      assert.equal(prompt.split(copy[stage]).length, 2);
      assert.doesNotMatch(prompt, /\{\{|\[INSERIR/);
      assert.deepEqual(
        JSON.parse(task.original.imagePrompt),
        stage === 'hook' || singleImage ? hookImage : presenterImage,
      );
      const role =
        format === 'full-pov' || (format === 'pov' && stage === 'hook')
          ? 'pov'
          : format.startsWith('factory') && stage === 'hook'
            ? format === 'factory-inclined'
              ? 'factory-inclined'
              : 'factory'
            : 'seller';
      assert.match(prompt, new RegExp(`Role: ${role}\\.`));
      assert.match(prompt.split('\n').at(-1)!, /^Visual exclusions:/);
    }
    assert.equal(manifest.tasks[0]!.reuseImageFrom, undefined);
    assert.equal(
      manifest.tasks[1]!.reuseImageFrom,
      singleImage ? manifest.tasks[0]!.id : undefined,
    );
    assert.equal(
      manifest.tasks[2]!.reuseImageFrom,
      manifest.tasks[singleImage ? 0 : 1]!.id,
    );
    assert.equal(importImageCount(manifest), singleImage ? 1 : 2);
    assert.deepEqual(
      manifest.tasks.map((task) => task.output?.filename),
      ['01-Gancho.mp4', '02-Body.mp4', '03-CTA.mp4'],
    );
  });
}

test('preparation requires exactly one image for full formats and a presenter image for mixed formats', () => {
  const hookImage = {
    prompt: 'Static complete product reference.',
    negative_prompt: 'No graphics.',
    aspect_ratio: '9:16',
  };
  const variation = {
    id: randomUUID(),
    name: 'Fixture',
    hookImage,
    copy: { hook: 'Gancho.', body: 'Body.', cta: 'CTA.' },
  };
  const plan = {
    version: 1,
    id: randomUUID(),
    product: 'Fixture',
    reference: 'ref.png',
  };
  for (const format of ['full-pov', 'seller', 'pov', 'factory'] as const) {
    const parse = (presenterImage?: typeof hookImage): boolean =>
      preparationSchema.safeParse({
        ...plan,
        variations: [
          {
            ...variation,
            format,
            ...(presenterImage ? { presenterImage } : {}),
          },
        ],
      }).success;
    const singleImage = format === 'full-pov' || format === 'seller';
    assert.equal(parse(), singleImage);
    assert.equal(parse(hookImage), !singleImage);
  }
});
