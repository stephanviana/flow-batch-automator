import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { instructions } from './instruction-fixture.js';
import {
  compilePreparation,
  preparationSchema,
  importImageCount,
  type CloneScenePlan,
  type Preparation,
} from '../src/index.js';

function scenePlan(pattern: string): CloneScenePlan {
  return {
    scenes: [...new Set(pattern)].map((id) => ({
      id,
      image: {
        prompt: `Product in scene ${id}.`,
        negative_prompt: 'No interface.',
        aspect_ratio: '9:16',
      },
    })),
    takes: { hook: pattern[0]!, body: pattern[1]!, cta: pattern[2]! },
  };
}
function preparation(pattern: string, preserveCopy = false): Preparation {
  const copy = {
    hook: 'Gancho exato.',
    body: 'Body exato.',
    cta: 'CTA exato.',
  };
  return {
    version: 1,
    id: randomUUID(),
    product: 'Produto do print',
    reference: 'foto-principal.png',
    imageModel: 'GEM_PIX_2',
    videoModel: 'abra_i2v_8s',
    variations: [
      {
        id: randomUUID(),
        name: 'Clone',
        format: 'clone',
        copy,
        cloneVideo: {
          materialId: randomUUID(),
          mode: preserveCopy ? 'preserve-copy' : 'adapt-format',
          ...(preserveCopy ? { transcript: { ...copy } } : {}),
          analysis: 'Cenas identificadas no MP4 e adaptadas aos três takes.',
          scenePlan: scenePlan(pattern),
          directions: {
            hook: 'Show scene.',
            body: 'Demonstrate.',
            cta: 'Close.',
          },
        },
      },
    ],
  };
}

for (const preserveCopy of [false, true])
  for (const [pattern, sources] of [
    ['aaa', [undefined, 0, 0]],
    ['aab', [undefined, 0, undefined]],
    ['aba', [undefined, undefined, 0]],
    ['abb', [undefined, undefined, 1]],
    ['abc', [undefined, undefined, undefined]],
  ] as const)
    test(`scene plan ${pattern} compiles direct sources in ${preserveCopy ? 'preserve-copy' : 'adapt-format'}`, async () => {
      const plan = preparation(pattern, preserveCopy);
      const manifest = await compilePreparation(
        plan,
        instructions.animationTemplates,
      );
      assert.equal(importImageCount(manifest), new Set(pattern).size);
      for (const [index, take] of manifest.tasks.entries()) {
        const source = sources[index];
        assert.equal(
          take.reuseImageFrom,
          source === undefined ? undefined : manifest.tasks[source]!.id,
        );
        assert.equal(take.reference, plan.reference);
        assert.equal(
          JSON.parse(take.original.imagePrompt).prompt,
          `Product in scene ${pattern[index]}.`,
        );
        if (source !== undefined)
          assert.equal(manifest.tasks[source]!.reuseImageFrom, undefined);
      }
      assert.deepEqual(
        manifest.tasks.map((take) => take.original.copy),
        Object.values(plan.variations[0]!.copy),
      );
    });

test('scene plans reject ambiguous images, duplicate or unused scenes and missing or foreign take bindings', () => {
  const plan = preparation('abc');
  const variation = plan.variations[0]!;
  const clone = variation.cloneVideo!;
  const scenes = clone.scenePlan!;
  const invalidPlans: unknown[] = [
    { ...scenes, scenes: [] },
    {
      ...scenes,
      scenes: [scenes.scenes[0], scenes.scenes[0], scenes.scenes[2]],
    },
    { ...scenes, scenes: [...scenes.scenes, { ...scenes.scenes[0], id: 'd' }] },
    { ...scenes, takes: { ...scenes.takes, cta: 'foreign' } },
    { ...scenes, takes: { hook: 'a', body: 'b' } },
    { ...scenes, takes: { hook: 'a', body: 'a', cta: 'a' } },
  ];
  for (const scenePlan of invalidPlans)
    assert.equal(
      preparationSchema.safeParse({
        ...plan,
        variations: [{ ...variation, cloneVideo: { ...clone, scenePlan } }],
      }).success,
      false,
    );
  for (const extra of [
    { hookImage: scenes.scenes[0]!.image },
    { presenterImage: scenes.scenes[0]!.image },
    { cloneVideo: { ...clone, imageStrategy: 'shared' } },
    { cloneVideo: { ...clone, scenePlan: undefined } },
    { format: 'factory' },
    { format: 'seller', cloneVideo: undefined },
  ])
    assert.equal(
      preparationSchema.safeParse({
        ...plan,
        variations: [{ ...variation, ...extra }],
      }).success,
      false,
    );
});

test('each variation generates its own scene images even when scene IDs match', async () => {
  const first = preparation('aaa');
  const second = preparation('aaa').variations[0]!;
  first.variations.push(second);
  const manifest = await compilePreparation(
    first,
    instructions.animationTemplates,
  );
  assert.equal(importImageCount(manifest), 2);
  assert.equal(manifest.tasks[4]!.reuseImageFrom, manifest.tasks[3]!.id);
  assert.equal(manifest.tasks[5]!.reuseImageFrom, manifest.tasks[3]!.id);
  assert.notEqual(manifest.tasks[0]!.id, manifest.tasks[3]!.id);
});
