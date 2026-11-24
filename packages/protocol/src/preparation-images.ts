import { z } from 'zod';
import type { PreparationFormat } from './preparations.js';

const imageText = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => value.trim().length > 0);
export const creativeImageSchema = z.strictObject({
  prompt: imageText,
  negative_prompt: imageText,
  aspect_ratio: z.literal('9:16'),
});
export type CreativeImage = z.infer<typeof creativeImageSchema>;
export const cloneImageStrategySchema = z.enum(['shared', 'hook-body']);
export type CloneImageStrategy = z.infer<typeof cloneImageStrategySchema>;
const sceneIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/);
export const cloneScenePlanSchema = z
  .strictObject({
    scenes: z
      .array(z.strictObject({ id: sceneIdSchema, image: creativeImageSchema }))
      .min(1)
      .max(3),
    takes: z.strictObject({
      hook: sceneIdSchema,
      body: sceneIdSchema,
      cta: sceneIdSchema,
    }),
  })
  .superRefine((plan, context) => {
    const ids = new Set(plan.scenes.map((scene) => scene.id));
    if (ids.size !== plan.scenes.length)
      context.addIssue({
        code: 'custom',
        path: ['scenes'],
        message: 'Cada cena precisa de um ID distinto.',
      });
    for (const stage of ['hook', 'body', 'cta'] as const)
      if (!ids.has(plan.takes[stage]))
        context.addIssue({
          code: 'custom',
          path: ['takes', stage],
          message: 'O take deve apontar para uma cena definida nesta variação.',
        });
    const used = new Set(Object.values(plan.takes));
    if (plan.scenes.some((scene) => !used.has(scene.id)))
      context.addIssue({
        code: 'custom',
        path: ['scenes'],
        message: 'Todas as cenas definidas devem ser usadas por algum take.',
      });
  });
export type CloneScenePlan = z.infer<typeof cloneScenePlanSchema>;

interface ImageVariation {
  format: PreparationFormat;
  hookImage?: CreativeImage | undefined;
  presenterImage?: CreativeImage | undefined;
  cloneVideo?:
    | {
        imageStrategy?: CloneImageStrategy | undefined;
        scenePlan?: CloneScenePlan | undefined;
      }
    | undefined;
}
export interface TakeImagePlan {
  image: CreativeImage;
  sourceIndex?: number;
}

export function usesSingleImage(
  format: PreparationFormat,
  strategy?: CloneImageStrategy,
): boolean {
  return (
    format === 'full-pov' ||
    format === 'seller' ||
    (format === 'clone' && strategy === 'shared')
  );
}

export function validateVariationImages(
  variation: ImageVariation,
  context: z.RefinementCtx,
): void {
  if (variation.cloneVideo?.scenePlan) {
    if (
      variation.hookImage ||
      variation.presenterImage ||
      variation.cloneVideo.imageStrategy
    )
      context.addIssue({
        code: 'custom',
        path: ['cloneVideo', 'scenePlan'],
        message:
          'O plano de cenas substitui hookImage, presenterImage e imageStrategy; não combine os dois contratos.',
      });
    return;
  }
  if (!variation.hookImage)
    context.addIssue({
      code: 'custom',
      path: ['hookImage'],
      message: 'Informe hookImage ou um plano de cenas para a clonagem.',
    });
  const singleImage = usesSingleImage(
    variation.format,
    variation.cloneVideo?.imageStrategy,
  );
  if (
    singleImage
      ? variation.presenterImage !== undefined
      : variation.presenterImage === undefined
  )
    context.addIssue({
      code: 'custom',
      path: ['presenterImage'],
      message:
        'Full POV, Full Vendedora e clone shared usam somente hookImage; os demais formatos sem plano de cenas exigem presenterImage.',
    });
}

export function variationImagePlan(variation: ImageVariation): TakeImagePlan[] {
  const scenes = variation.cloneVideo?.scenePlan;
  const singleImage = usesSingleImage(
    variation.format,
    variation.cloneVideo?.imageStrategy,
  );
  const sceneIds = scenes
    ? [scenes.takes.hook, scenes.takes.body, scenes.takes.cta]
    : singleImage
      ? ['hook', 'hook', 'hook']
      : ['hook', 'body', 'body'];
  return sceneIds.map((id, index) => {
    const image = scenes
      ? scenes.scenes.find((scene) => scene.id === id)?.image
      : id === 'hook'
        ? variation.hookImage
        : variation.presenterImage;
    if (!image)
      throw new Error('Imagem da cena indisponível; revise a preparação.');
    const firstIndex = sceneIds.indexOf(id);
    return {
      image,
      ...(firstIndex < index ? { sourceIndex: firstIndex } : {}),
    };
  });
}
