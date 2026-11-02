import { z } from 'zod';
import { preparationFormatSchema, preparationSchema } from './preparations.js';

export const MATERIAL_LIMIT = 8_388_608;
export const materialSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(180),
  mime: z.enum([
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/pdf',
    'text/plain',
    'application/json',
  ]),
  size: z.number().int().min(1).max(MATERIAL_LIMIT),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  available: z.boolean(),
});
export type Material = z.infer<typeof materialSchema>;
export const orderProductSchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string().trim().min(1).max(120),
    information: z.string().max(8000),
    materials: z.array(z.uuid()).min(1).max(30),
    referenceId: z.uuid(),
    groups: z
      .array(
        z.strictObject({
          id: z.uuid(),
          format: preparationFormatSchema,
          count: z.number().int().min(1).max(20),
        }),
      )
      .min(1)
      .max(6),
  })
  .superRefine((product, context) => {
    if (
      !product.materials.includes(product.referenceId) ||
      new Set(product.materials).size !== product.materials.length ||
      new Set(product.groups.map((group) => group.id)).size !==
        product.groups.length
    )
      context.addIssue({
        code: 'custom',
        message: 'Materiais, referência ou grupos incompatíveis.',
      });
  });
export const orderDraftSchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string().trim().min(1).max(120),
    products: z.array(orderProductSchema).min(1).max(30),
  })
  .superRefine((order, context) => {
    if (
      new Set(order.products.map((product) => product.id)).size !==
        order.products.length ||
      order.products.reduce(
        (sum, product) =>
          sum + product.groups.reduce((n, group) => n + group.count, 0),
        0,
      ) > 120
    )
      context.addIssue({
        code: 'custom',
        message: 'Use produtos distintos e no máximo 120 variações por pedido.',
      });
  });
export type OrderDraft = z.infer<typeof orderDraftSchema>;
export const orderPublicationSchema = z.strictObject({
  leaseId: z.uuid(),
  products: z
    .array(
      z.strictObject({
        id: z.uuid(),
        variations: z
          .array(preparationSchema.shape.variations.element)
          .min(1)
          .max(120),
      }),
    )
    .min(1)
    .max(30),
});
export type OrderPublication = z.infer<typeof orderPublicationSchema>;
export type OrderState =
  | 'awaiting-preparation'
  | 'preparing'
  | 'prepared'
  | 'dispatched'
  | 'completed'
  | 'failed'
  | 'uncertain'
  | 'blocked'
  | 'cancelled';
