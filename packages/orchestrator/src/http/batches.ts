import type { FastifyInstance } from 'fastify';
import { BROWSER_EXECUTOR_ID, batchActionSchema } from '@flow-batch/protocol';
import type { SignatureService } from '../security/signatures.js';
import type { ClientStore } from '../persistence/clients.js';
import type { BatchStore } from '../persistence/batches.js';
import type { QueueRepository } from '../queue/repository.js';

export function registerBatchRoutes(
  app: FastifyInstance,
  signatures: SignatureService,
  clients: ClientStore,
  batches: BatchStore,
  queue: QueueRepository,
): void {
  app.get('/api/batches', async (request) => {
    const client = await signatures.http(request);
    clients.authorized(client.id, client.extensionId);
    return { batches: batches.list(client.id) };
  });
  app.post('/api/batches', async (request) => {
    const client = await signatures.http(request);
    clients.authorized(client.id, client.extensionId);
    const action = batchActionSchema.parse(request.body);
    if (
      action.action === 'claim' &&
      client.extensionId === BROWSER_EXECUTOR_ID &&
      !queue.canPrepareDispatch(client.id)
    )
      return { batch: batches.get(client.id, action.id) };
    return batches.action(client.id, action);
  });
}
