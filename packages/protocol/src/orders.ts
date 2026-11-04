import { z } from 'zod';
import { preparationFormatSchema, preparationSchema } from './preparations.js';

export {
  MATERIAL_LIMIT,
  VIDEO_MATERIAL_LIMIT,
  materialSchema,
  materialFilename,
  type Material,
} from './materials.js';
export const ORDER_GROUP_LIMIT = 8;
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
          videoReferenceId: z.uuid().optional(),
        }),
      )
      .min(1)
      .max(ORDER_GROUP_LIMIT),
  })
  .superRefine((product, context) => {
    for (const group of product.groups) {
      if (
        (group.format === 'clone') !== (group.videoReferenceId !== undefined) ||
        (group.videoReferenceId &&
          !product.materials.includes(group.videoReferenceId))
      )
        context.addIssue({
          code: 'custom',
          message:
            'Clonar formato exige um vídeo dos materiais deste produto; os demais formatos não usam vídeo de referência.',
        });
    }
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
