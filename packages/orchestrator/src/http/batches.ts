import type { FastifyInstance } from 'fastify';
import { batchActionSchema } from '@flow-batch/protocol';
import type { SignatureService } from '../security/signatures.js';
import type { ClientStore } from '../persistence/clients.js';
import type { BatchStore } from '../persistence/batches.js';

export function registerBatchRoutes(
  app: FastifyInstance,
  signatures: SignatureService,
  clients: ClientStore,
  batches: BatchStore,
): void {
  app.get('/api/batches', async (request) => {
    const client = await signatures.http(request);
    clients.authorized(client.id, client.extensionId);
    return { batches: batches.list(client.id) };
  });
  app.post('/api/batches', async (request) => {
    const client = await signatures.http(request);
    clients.authorized(client.id, client.extensionId);
    return batches.action(client.id, batchActionSchema.parse(request.body));
  });
}
