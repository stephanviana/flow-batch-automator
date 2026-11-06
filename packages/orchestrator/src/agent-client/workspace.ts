import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import {
  materialFilename,
  usesSingleImage,
  libraryFileSchema,
  orderPublicationSchema,
  type OrderPublication,
  type OrderExecution,
} from '@flow-batch/protocol';
import type { ProductionOrder } from '../orders/repository.js';
import type { variationPlan as plan } from '../orders/preparation.js';
import { requireContract, type AgentApi } from './http.js';

type Lease = { leaseId: string; order: ProductionOrder };
type Context = {
  revision: string;
  instructions: { path: string; text: string }[];
  rules: string;
};
export interface CheckoutResult {
  number: number;
  leaseId: string;
  order: ProductionOrder;
  variationPlan: Awaited<ReturnType<typeof plan>>;
  preparation: Record<string, unknown>;
  directory: string;
  expiresAt: number;
  context: Context;
  materials: (ProductionOrder['materials'][number] & { path: string })[];
  preparationFile: string;
}
async function optionalJson(
  filename: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(filename, 'utf8')) as Record<
      string,
      unknown
    >;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
}
async function jsonFile(filename: string, value: unknown): Promise<void> {
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  await writeFile(filename, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  });
}
async function writeMaterials(
  api: AgentApi,
  order: ProductionOrder,
  context: Context,
  directory: string,
): Promise<void> {
  for (const instruction of context.instructions) {
    libraryFileSchema.parse(instruction.path);
    const filename = resolve(directory, instruction.path);
    const local = relative(directory, filename);
    if (local.startsWith('..') || isAbsolute(local))
      throw new Error('Caminho de instrução inválido.');
    await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
    await writeFile(filename, instruction.text, { mode: 0o600 });
  }
  for (const material of order.materials) {
    const bytes = await api(
      `/manage/materials/${material.id}`,
      undefined,
      true,
    );
    if (
      bytes.length !== material.size ||
      createHash('sha256').update(bytes).digest('hex') !== material.sha256
    )
      throw new Error('Material recebido difere do arquivo registrado.');
    await writeFile(resolve(directory, materialFilename(material)), bytes, {
      mode: 0o600,
    });
  }
}
function draftProducts(
  order: ProductionOrder,
  variationPlan: Awaited<ReturnType<typeof plan>>,
): OrderPublication['products'] {
  const products = order.products.map((product) => ({
    id: product.id,
    variations: variationPlan
      .filter((variation) => variation.productId === product.id)
      .map(({ id, name, format, videoReferenceId }) => ({
        id,
        name,
        format,
        ...(videoReferenceId
          ? {
              cloneVideo: {
                materialId: videoReferenceId,
                analysis: '',
                directions: { hook: '', body: '', cta: '' },
              },
            }
          : {}),
        hookImage: {
          prompt: '',
          negative_prompt: '',
          aspect_ratio: '9:16' as const,
        },
        ...(!usesSingleImage(format)
          ? {
              presenterImage: {
                prompt: '',
                negative_prompt: '',
                aspect_ratio: '9:16' as const,
              },
            }
          : {}),
        copy: { hook: '', body: '', cta: '' },
      })),
  }));
  return products;
}
export async function checkout(
  api: AgentApi,
  number: number,
  worker: string,
  directory: string,
  revise = false,
): Promise<CheckoutResult> {
  await requireContract(api);
  const { order, variationPlan } = await api<{
    order: ProductionOrder;
    variationPlan: Awaited<ReturnType<typeof plan>>;
  }>(`/manage/orders/${number}`);
  const existing = (await optionalJson(resolve(directory, 'pedido.json'))) as
    (Lease & { variationPlan: unknown }) | undefined;
  let lease: Lease;
  if (existing?.order.id === order.id && order.state === 'preparing') {
    lease = {
      leaseId: existing.leaseId,
      order: await api(`/manage/orders/${order.id}/heartbeat`, {
        leaseId: existing.leaseId,
      }),
    };
  } else
    lease = await api(`/manage/orders/${order.id}/claim`, { worker, revise });
  const context = await api<Context>(`/manage/orders/${order.id}/context`, {
    leaseId: lease.leaseId,
  });
  await jsonFile(resolve(directory, 'pedido.json'), {
    ...lease,
    variationPlan,
    libraryRevision: context.revision,
  });
  await jsonFile(resolve(directory, 'contexto.json'), context);
  await writeMaterials(api, order, context, directory);
  const products = draftProducts(order, variationPlan);
  const previous = await optionalJson(resolve(directory, 'preparacao.json'));
  const preparation = {
    ...(existing?.order.id === order.id && previous
      ? previous
      : { products: order.preparation?.products ?? products }),
    leaseId: lease.leaseId,
    libraryRevision: context.revision,
  };
  await jsonFile(resolve(directory, 'preparacao.json'), preparation);
  return {
    number,
    leaseId: lease.leaseId,
    order: lease.order,
    variationPlan,
    preparation,
    directory,
    expiresAt: lease.order.lease!.expiresAt,
    context,
    materials: order.materials.map((material) => ({
      ...material,
      path: resolve(directory, materialFilename(material)),
    })),
    preparationFile: resolve(directory, 'preparacao.json'),
  };
}
export async function publishWorkspace(
  api: AgentApi,
  directory: string,
  execution?: OrderExecution,
  preparationFile = resolve(directory, 'preparacao.json'),
): Promise<ProductionOrder> {
  await requireContract(api);
  const lease = (await optionalJson(resolve(directory, 'pedido.json'))) as
    Lease | undefined;
  if (!lease) throw new Error('Faça a reserva do pedido antes de publicar.');
  const preparation = await optionalJson(preparationFile);
  if (!preparation) throw new Error('Preparação não encontrada.');
  return api(`/manage/orders/${lease.order.id}/prepare`, {
    ...orderPublicationSchema.parse(preparation),
    ...(execution ? { execution } : {}),
  });
}
