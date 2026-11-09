import { z } from 'zod';
import { imageSelectionSchema, flowVideoModelSchema } from './flow-models.js';
import { importTakeSchema } from './imports.js';

const nonblankText = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => value.trim().length > 0);
export const creativeImageSchema = z.strictObject({
  prompt: nonblankText,
  negative_prompt: nonblankText,
  aspect_ratio: z.literal('9:16'),
});
export const preparationFormatSchema = z.enum([
  'factory',
  'factory-group',
  'factory-truck',
  'factory-inclined',
  'pov',
  'full-pov',
  'seller',
  'clone',
]);
export type PreparationFormat = z.infer<typeof preparationFormatSchema>;
export function usesSingleImage(format: PreparationFormat): boolean {
  return format === 'full-pov' || format === 'seller';
}
export const preparationFormatLabels: Record<PreparationFormat, string> = {
  factory: 'Fábrica Padrão',
  'factory-group': 'Fábrica Grupo',
  'factory-truck': 'Fábrica + Caminhão',
  'factory-inclined': 'Fábrica Esteira Inclinada',
  pov: 'POV + Vendedora',
  'full-pov': 'Full POV',
  seller: 'Full Vendedora',
  clone: 'Clonar formato de vídeo',
};
export const cloneModeSchema = z.enum(['adapt-format', 'preserve-copy']);
export type CloneMode = z.infer<typeof cloneModeSchema>;
export const DEFAULT_CLONE_MODE: CloneMode = 'adapt-format';
export const cloneModeLabels: Record<CloneMode, string> = {
  'adapt-format': 'Adaptar formato e criar nova copy',
  'preserve-copy': 'Manter copy original e mudar cenário e avatar',
};
export const takeCopySchema = z.strictObject({
  hook: nonblankText,
  body: nonblankText,
  cta: nonblankText,
});
export const cloneVideoSchema = z.strictObject({
  materialId: z.uuid(),
  mode: cloneModeSchema.optional(),
  transcript: takeCopySchema.optional(),
  analysis: nonblankText,
  directions: z.strictObject({
    hook: nonblankText,
    body: nonblankText,
    cta: nonblankText,
  }),
});
export const preparationSchema = z
  .strictObject({
    version: z.literal(1),
    id: z.uuid(),
    product: importTakeSchema.shape.product,
    reference: importTakeSchema.shape.reference,
    imageModel: imageSelectionSchema.default('GEM_PIX_2'),
    videoModel: flowVideoModelSchema.default('abra_i2v_8s'),
    variations: z
      .array(
        z
          .strictObject({
            id: z.uuid(),
            name: z.string().trim().min(1).max(80),
            format: preparationFormatSchema,
            hookImage: creativeImageSchema,
            presenterImage: creativeImageSchema.optional(),
            cloneVideo: cloneVideoSchema.optional(),
            copy: takeCopySchema,
          })
          .refine(
            (variation) =>
              usesSingleImage(variation.format)
                ? variation.presenterImage === undefined
                : variation.presenterImage !== undefined,
            {
              message:
                'Full POV e Full Vendedora usam somente hookImage; os demais formatos exigem presenterImage.',
              path: ['presenterImage'],
            },
          )
          .refine(
            (variation) =>
              (variation.format === 'clone') ===
              (variation.cloneVideo !== undefined),
            'A clonagem exige análise e direções do vídeo; os demais formatos não usam cloneVideo.',
          )
          .superRefine((variation, context) => {
            const clone = variation.cloneVideo;
            if (!clone) return;
            if (clone.mode !== 'preserve-copy') {
              if (clone.transcript !== undefined)
                context.addIssue({
                  code: 'custom',
                  path: ['cloneVideo', 'transcript'],
                  message: 'Transcrição preservada exige preserve-copy.',
                });
              return;
            }
            if (!clone.transcript) {
              context.addIssue({
                code: 'custom',
                path: ['cloneVideo', 'transcript'],
                message: 'Informe a transcrição conferida do vídeo original.',
              });
              return;
            }
            for (const stage of ['hook', 'body', 'cta'] as const)
              if (clone.transcript[stage] !== variation.copy[stage])
                context.addIssue({
                  code: 'custom',
                  path: ['copy', stage],
                  message:
                    'A copy deve ser idêntica à transcrição original, incluindo espaços.',
                });
          }),
      )
      .min(1)
      .max(6),
  })
  .refine(
    (plan) =>
      new Set(plan.variations.map((variation) => variation.id)).size ===
      plan.variations.length,
    'Each variation needs a distinct ID',
  );
export type Preparation = z.infer<typeof preparationSchema>;
