import { randomUUID } from 'node:crypto';
import {
  dispatchCommandSchema,
  importImageCount,
  stableImportId,
  type DispatchCommand,
} from '@flow-batch/protocol';
import { DispatchStore } from '../persistence/dispatch.js';
import type { OrderRepository } from './repository.js';
import { referencePath } from './preparation.js';
import { HttpError } from '../security/errors.js';

export async function dispatchOrder(
  repository: OrderRepository,
  id: string,
  clientId: string,
  authorize: () => void = () => {},
): Promise<ReturnType<OrderRepository['get']>> {
  const order = repository.get(id);
  if (order.archivedAt)
    throw new HttpError(
      409,
      'Este pedido foi removido da lista e não pode ser enviado.',
    );
  if (order.state === 'dispatched' || order.state === 'completed') {
    authorize();
    return order;
  }
  if (order.state !== 'prepared' || !order.preparation)
    throw new HttpError(409, 'Confira a preparação atual antes de autorizar.');
  if (order.materials.some((material) => !material.available))
    throw new HttpError(409, 'Material indisponível.');
  const approvedAt = Date.now();
  const preparation = JSON.stringify(order.preparation);
  const commands: { command: DispatchCommand; batchId: string }[] = [];
  for (const manifest of order.preparation.manifests) {
    const paths = new Set(manifest.tasks.map((take) => take.reference));
    const references = order.materials
      .filter((material) => paths.has(referencePath(material)))
      .map((material) => ({
        path: referencePath(material),
        sha256: material.sha256,
        size: material.size,
      }));
    commands.push({
      command: dispatchCommandSchema.parse({
        version: 1,
        id: randomUUID(),
        clientId,
        name: `${order.name} · ${manifest.tasks[0]!.product}`.slice(0, 120),
        source: 'managed',
        manifest,
        references,
        authorization: {
          approvedAt,
          expiresAt: approvedAt + 86_400_000,
          imageGenerations: importImageCount(manifest),
          videoGenerations: manifest.tasks.length,
        },
      }),
      batchId: await stableImportId([
        'flow-dispatch-v1',
        clientId,
        manifest.id,
      ]),
    });
  }
  return repository.transaction(() => {
    const current = repository.get(id);
    if (
      current.state !== 'prepared' ||
      JSON.stringify(current.preparation) !== preparation
    )
      throw new HttpError(409, 'Pedido já alterado. Consulte seu estado.');
    if (current.materials.some((material) => !material.available))
      throw new HttpError(409, 'Material indisponível.');
    authorize();
    const store = new DispatchStore(repository.database);
    for (const { command, batchId } of commands) {
      store.register(clientId, command);
      repository.database
        .prepare(
          'INSERT INTO order_dispatches (order_id,dispatch_id,batch_id) VALUES (?,?,?)',
        )
        .run(id, command.id, batchId);
    }
    repository.database
      .prepare("UPDATE production_orders SET state='dispatched' WHERE id=?")
      .run(id);
    return repository.get(id);
  });
}
