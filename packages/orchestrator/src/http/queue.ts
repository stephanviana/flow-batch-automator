import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { enqueueSchema, queueActionSchema } from '@flow-batch/protocol';
import type { SignatureService } from '../security/signatures.js';
import type { ClientStore } from '../persistence/clients.js';
import type { QueueRepository } from '../queue/repository.js';
import type { QueueMutations } from '../queue/mutations.js';
import type { QueueEngine } from '../queue/engine.js';

export function registerQueueRoutes(
  app: FastifyInstance,
  signatures: SignatureService,
  clients: ClientStore,
  repository: QueueRepository,
  mutations: QueueMutations,
  engine: QueueEngine,
): void {
  app.get('/api/queue', async (request) => {
    const client = await signatures.http(request);
    clients.authorized(client.id, client.extensionId);
    return repository.snapshot(client.id);
  });
  app.post('/api/queue', async (request) => {
    const client = await signatures.http(request);
    clients.authorized(client.id, client.extensionId);
    const input = enqueueSchema.parse(request.body);
    const tasks = repository.enqueue(client.id, input.requestId, input.tasks);
    engine.wake();
    return { tasks };
  });
  app.post('/api/queue/control', async (request) => {
    const client = await signatures.http(request);
    clients.authorized(client.id, client.extensionId);
    const input = z
      .strictObject({ action: z.enum(['start', 'pause']) })
      .parse(request.body);
    repository.control(client.id, input.action === 'start');
    engine.wake();
    return repository.snapshot(client.id);
  });
  app.post('/api/queue/actions', async (request) => {
    const client = await signatures.http(request);
    clients.authorized(client.id, client.extensionId);
    const task = mutations.action(
      client.id,
      queueActionSchema.parse(request.body),
    );
    engine.wake();
    return { task };
  });
  app.post('/api/queue/task', async (request) => {
    const client = await signatures.http(request);
    clients.authorized(client.id, client.extensionId);
    const { taskId } = z.strictObject({ taskId: z.uuid() }).parse(request.body);
    return repository.database.detail(taskId, client.id);
  });
}
