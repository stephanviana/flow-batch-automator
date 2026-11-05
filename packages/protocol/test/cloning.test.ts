import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { instructions } from './instruction-fixture.js';
const { animationTemplates } = instructions;
import { test } from 'node:test';
import {
  compilePreparation,
  preparationSchema,
  orderProductSchema,
  materialSchema,
  MATERIAL_LIMIT,
  type Preparation,
  VIDEO_MATERIAL_LIMIT,
} from '../src/index.js';

function variation(): Preparation['variations'][number] & {
  cloneVideo: NonNullable<Preparation['variations'][number]['cloneVideo']>;
} {
  return {
    id: randomUUID(),
    name: 'Clonagem 1',
    format: 'clone' as const,
    hookImage: {
      prompt: 'Mãos com o produto real.',
      negative_prompt: 'Sem texto.',
      aspect_ratio: '9:16' as const,
    },
    presenterImage: {
      prompt: 'Produto apoiado no balcão.',
      negative_prompt: 'Sem bandeja.',
      aspect_ratio: '9:16' as const,
    },
    copy: {
      hook: 'Veja este produto.',
      body: 'Conheça os detalhes.',
      cta: 'Confira no carrinho.',
    },
    cloneVideo: {
      materialId: randomUUID(),
      analysis:
        'Gancho de descoberta seguido da apresentação e de chamada de compra.',
      directions: {
        hook: 'Only hands and off-camera voice.',
        body: 'Show the product on the counter.',
        cta: 'Keep the same counter and speak naturally.',
      },
    },
  };
}
test('cloned formats require a product-owned video and complete adaptation, without changing legacy formats', () => {
  const image = randomUUID(),
    video = randomUUID();
  const product = {
    id: randomUUID(),
    name: 'Produto',
    information: '',
    materials: [image, video],
    referenceId: image,
    groups: [
      { id: randomUUID(), format: 'clone', count: 1, videoReferenceId: video },
    ],
  };
  assert.equal(orderProductSchema.safeParse(product).success, true);
  for (const group of [
    { ...product.groups[0], videoReferenceId: undefined },
    { ...product.groups[0], videoReferenceId: randomUUID() },
    { ...product.groups[0], format: 'factory' },
  ])
    assert.equal(
      orderProductSchema.safeParse({ ...product, groups: [group] }).success,
      false,
    );
  const clone = variation();
  const plan = {
    version: 1,
    id: randomUUID(),
    product: 'Produto',
    reference: `${image}.png`,
    variations: [clone],
  };
  assert.equal(preparationSchema.safeParse(plan).success, true);
  for (const changed of [
    { ...clone, cloneVideo: undefined },
    { ...clone, cloneVideo: { ...clone.cloneVideo, analysis: ' ' } },
    { ...clone, format: 'factory' },
  ])
    assert.equal(
      preparationSchema.safeParse({ ...plan, variations: [changed] }).success,
      false,
    );
  assert.equal(
    preparationSchema.safeParse({
      ...plan,
      variations: [{ ...clone, format: 'factory', cloneVideo: undefined }],
    }).success,
    true,
  );
});
test('cloning compiles adapted directions and exact speech, with the image pair and shared Body/CTA frame intact', async () => {
  const clone = variation();
  const reference = `${randomUUID()}.png`;
  const manifest = await compilePreparation(
    {
      version: 1,
      id: randomUUID(),
      product: 'Produto',
      reference,
      variations: [clone],
    },
    animationTemplates,
  );
  assert.equal(manifest.tasks.length, 3);
  for (const [index, stage] of (['hook', 'body', 'cta'] as const).entries()) {
    const task = manifest.tasks[index]!;
    assert.equal(task.reference, reference);
    assert.equal(task.original.copy, clone.copy[stage]);
    assert.ok(
      task.original.videoPrompt.includes(clone.cloneVideo.directions[stage]),
    );
    assert.ok(task.original.videoPrompt.includes(clone.copy[stage]));
    assert.match(
      task.original.videoPrompt.split('\n').at(-1)!,
      /^Visual exclusions:/,
    );
    assert.equal(task.original.videoPrompt.includes('{{'), false);
    assert.equal(task.videoModel, 'abra_i2v_8s');
    assert.equal(task.imageModel, 'GEM_PIX_2');
  }
  assert.equal(manifest.tasks[2]!.reuseImageFrom, manifest.tasks[1]!.id);
  assert.equal(manifest.tasks.filter((task) => !task.reuseImageFrom).length, 2);
});
test('video materials have their own cap while images and documents retain the 8 MB cap', () => {
  const material = {
    id: randomUUID(),
    name: 'ref.mp4',
    mime: 'video/mp4',
    size: MATERIAL_LIMIT + 1,
    sha256: 'a'.repeat(64),
    available: true,
  };
  assert.equal(materialSchema.safeParse(material).success, true);
  assert.equal(
    materialSchema.safeParse({ ...material, size: VIDEO_MATERIAL_LIMIT + 1 })
      .success,
    false,
  );
  assert.equal(
    materialSchema.safeParse({ ...material, mime: 'image/png' }).success,
    false,
  );
});
