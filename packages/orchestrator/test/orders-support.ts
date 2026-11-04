import { randomUUID } from 'node:crypto';
import {
  usesSingleImage,
  type OrderDraft,
  type OrderPublication,
} from '@flow-batch/protocol';
import type { ProductionOrder } from '../src/orders/repository.js';
import { variationPlan } from '../src/orders/preparation.js';

export const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
export function draft(materialId: string): OrderDraft {
  return {
    id: randomUUID(),
    name: 'Pedido fixture',
    products: [
      {
        id: randomUUID(),
        name: 'Produto A',
        information: 'Fatos do produto A',
        materials: [materialId],
        referenceId: materialId,
        groups: [
          { id: randomUUID(), format: 'factory', count: 2 },
          { id: randomUUID(), format: 'pov', count: 3 },
        ],
      },
      {
        id: randomUUID(),
        name: 'Produto B',
        information: 'Fatos do produto B',
        materials: [materialId],
        referenceId: materialId,
        groups: [{ id: randomUUID(), format: 'seller', count: 2 }],
      },
    ],
  };
}
export async function publication(
  order: ProductionOrder,
  leaseId: string,
): Promise<OrderPublication> {
  const plan = await variationPlan(order);
  return {
    leaseId,
    products: order.products.map((product) => ({
      id: product.id,
      variations: plan
        .filter((variation) => variation.productId === product.id)
        .map(({ id, name, format }) => ({
          id,
          name,
          format,
          hookImage: {
            prompt: 'Imagem de gancho do produto',
            negative_prompt: 'Sem texto',
            aspect_ratio: '9:16' as const,
          },
          ...(!usesSingleImage(format)
            ? {
                presenterImage: {
                  prompt: 'Vendedora e produto no balcão',
                  negative_prompt: 'Sem bandeja',
                  aspect_ratio: '9:16' as const,
                },
              }
            : {}),
          copy: {
            hook: 'Conheça este produto.',
            body: 'Veja os detalhes do produto.',
            cta: 'Confira o produto no carrinho.',
          },
        })),
    })),
  };
}
