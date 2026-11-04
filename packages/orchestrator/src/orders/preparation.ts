import {
  compilePreparation,
  stableImportId,
  type OrderPublication,
  type ImportManifest,
  type Preparation,
  materialFilename,
} from '@flow-batch/protocol';
import type { PreparedOrder, ProductionOrder } from './repository.js';
import { HttpError } from '../security/errors.js';
import { ZodError } from 'zod';

export { materialFilename as referencePath } from '@flow-batch/protocol';

function compilationError(
  product: string,
  variation: Preparation['variations'][number],
  error: unknown,
): HttpError {
  const reason =
    error instanceof ZodError
      ? error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')
      : error instanceof Error
        ? error.message
        : 'Prompts incompatíveis com o contrato.';
  return new HttpError(
    400,
    `Produto ${product}, variação ${variation.name} (${variation.id}): ${reason}`,
  );
}

export async function variationPlan(order: ProductionOrder): Promise<
  {
    productId: string;
    id: string;
    format: Preparation['variations'][number]['format'];
    name: string;
    videoReferenceId?: string;
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
          ...(group.videoReferenceId
            ? { videoReferenceId: group.videoReferenceId }
            : {}),
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
  const reference = materialFilename(
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
    } catch (error) {
      if (!chunk.length) throw compilationError(product.name, variation, error);
      manifests.push(await compile(chunk));
      chunk = [variation];
      try {
        await compile(chunk);
      } catch (error) {
        throw compilationError(product.name, variation, error);
      }
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
              planned.id === entry.id &&
              planned.format === entry.format &&
              planned.videoReferenceId === entry.cloneVideo?.materialId,
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
