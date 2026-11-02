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
  'seller',
]);
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
        z.strictObject({
          id: z.uuid(),
          name: z.string().trim().min(1).max(80),
          format: preparationFormatSchema,
          hookImage: creativeImageSchema,
          presenterImage: creativeImageSchema,
          copy: z.strictObject({
            hook: nonblankText,
            body: nonblankText,
            cta: nonblankText,
          }),
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
