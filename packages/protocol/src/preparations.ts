import { z } from 'zod';
import {
  imageSelectionSchema,
  flowVideoModelSchema,
  DEFAULT_ORDER_VIDEO_MODEL,
} from './flow-models.js';
import { importTakeSchema } from './imports.js';
import {
  creativeImageSchema,
  cloneImageStrategySchema,
  cloneScenePlanSchema,
  validateVariationImages,
} from './preparation-images.js';
export * from './preparation-images.js';

const nonblankText = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => value.trim().length > 0);
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
  imageStrategy: cloneImageStrategySchema
    .optional()
    .describe(
      'Compatibilidade com preparações anteriores. Para novas clonagens, use scenePlan conforme as cenas observadas no MP4.',
    ),
  scenePlan: cloneScenePlanSchema
    .optional()
    .describe(
      'Identifique as composições observadas no MP4 em analysis, defina uma imagem por cena usada e associe hook, body e cta a seus IDs. Cenas iguais reutilizam a mesma imagem; cenas distintas geram imagens próprias. Não preencher hookImage, presenterImage ou imageStrategy junto deste plano.',
    ),
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
    videoModel: flowVideoModelSchema.default(DEFAULT_ORDER_VIDEO_MODEL),
    variations: z
      .array(
        z
          .strictObject({
            id: z.uuid(),
            name: z.string().trim().min(1).max(80),
            format: preparationFormatSchema,
            hookImage: creativeImageSchema.optional(),
            presenterImage: creativeImageSchema.optional(),
            cloneVideo: cloneVideoSchema.optional(),
            copy: takeCopySchema,
          })
          .superRefine(validateVariationImages)
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
