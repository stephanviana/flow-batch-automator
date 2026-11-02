import {
  compilePreparation,
  stableImportId,
  type OrderPublication,
  type ImportManifest,
  type Preparation,
  type Material,
} from '@flow-batch/protocol';
import type { PreparedOrder, ProductionOrder } from './repository.js';
import { HttpError } from '../security/errors.js';

export function referencePath(material: Material): string {
  const extension = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'application/json': 'json',
  }[material.mime];
  return `${material.id}.${extension}`;
}

export async function variationPlan(order: ProductionOrder): Promise<
  {
    productId: string;
    id: string;
    format: Preparation['variations'][number]['format'];
    name: string;
  }[]
> {
  const plan = [];
  for (const product of order.products)
    for (const group of product.groups)
      for (let index = 0; index < group.count; index++)
        plan.push({
          productId: product.id,
          id: await stableImportId([
            'order-variation-v1',
            order.id,
            product.id,
            group.id,
            String(index),
          ]),
          format: group.format,
          name: `${group.format} ${index + 1}`,
        });
  return plan;
}

async function compileProduct(
  order: ProductionOrder,
  product: ProductionOrder['products'][number],
  variations: Preparation['variations'],
  templates: string,
): Promise<ImportManifest[]> {
  const reference = referencePath(
    order.materials.find((material) => material.id === product.referenceId)!,
  );
  const manifests: ImportManifest[] = [];
  let chunk: Preparation['variations'] = [];
  async function compile(
    entries: Preparation['variations'],
  ): Promise<ImportManifest> {
    const id = await stableImportId([
      'production-manifest-v1',
      order.id,
      product.id,
      ...entries.map((variation) => variation.id),
    ]);
    return compilePreparation(
      { version: 1, id, product: product.name, reference, variations: entries },
      templates,
    );
  }
  for (const variation of variations) {
    try {
      await compile([...chunk, variation]);
      chunk.push(variation);
    } catch {
      if (!chunk.length)
        throw new HttpError(
          400,
          'Uma variação excede os limites ou contém prompts incompatíveis.',
        );
      manifests.push(await compile(chunk));
      chunk = [variation];
      await compile(chunk);
    }
  }
  if (chunk.length) manifests.push(await compile(chunk));
  return manifests;
}

export async function prepareOrder(
  order: ProductionOrder,
  input: OrderPublication,
  templates: string,
): Promise<PreparedOrder> {
  if (
    input.products.length !== order.products.length ||
    new Set(input.products.map((product) => product.id)).size !==
      order.products.length
  )
    throw new HttpError(
      400,
      'A preparação deve cobrir exatamente os produtos do pedido.',
    );
  const expected = await variationPlan(order),
    manifests: ImportManifest[] = [];
  for (const product of order.products) {
    const prepared = input.products.find((entry) => entry.id === product.id);
    const variations = expected.filter(
      (entry) => entry.productId === product.id,
    );
    if (
      !prepared ||
      prepared.variations.length !== variations.length ||
      new Set(prepared.variations.map((entry) => entry.id)).size !==
        variations.length ||
      prepared.variations.some(
        (entry) =>
          !variations.some(
            (planned) =>
              planned.id === entry.id && planned.format === entry.format,
          ),
      )
    )
      throw new HttpError(
        400,
        'Formatos, quantidades ou IDs não correspondem ao pedido salvo.',
      );
    const sorted = variations.map((planned) =>
      prepared.variations.find((entry) => entry.id === planned.id)!,
    );
    manifests.push(
      ...(await compileProduct(order, product, sorted, templates)),
    );
  }
  return { products: input.products, manifests };
}
