import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { flowRetryActionSchema } from '@flow-batch/protocol';
import type { FastifyInstance } from 'fastify';
import type { LocalSessions } from '../security/local-session.js';
import type { OrderRepository } from '../orders/repository.js';
import type { ClientStore } from '../persistence/clients.js';
import { orderDiagnostic } from '../orders/diagnostics.js';
import type { QueueMutations } from '../queue/mutations.js';
import type { QueueEngine } from '../queue/engine.js';
import { HttpError } from '../security/errors.js';

const orderNumber = z.object({
  number: z.union([z.uuid(), z.coerce.number().int().positive()]),
});
const resolveSchema = z.strictObject({
  taskId: z.uuid(),
  expectedRevision: z.number().int().min(0),
  outcome: z.enum(['not_submitted', 'failed']),
  note: z.string().trim().min(1).max(500).optional(),
});
const cancelTaskSchema = z.strictObject({
  taskId: z.uuid(),
  expectedRevision: z.number().int().min(0),
});

function findTaskClientId(
  repository: OrderRepository,
  orderId: string,
  taskId: string,
): string {
  const owner = repository.database
    .prepare(
      `SELECT q.client_id FROM queue_tasks q JOIN order_dispatches d ON d.batch_id=q.batch_id
       WHERE q.id=? AND d.order_id=?`,
    )
    .get(taskId, orderId);
  if (!owner) throw new HttpError(404, 'Take não encontrado neste pedido.');
  return String(owner.client_id);
}

export function registerOrderDiagnostics(
  app: FastifyInstance,
  sessions: LocalSessions,
  repository: OrderRepository,
  clients: ClientStore,
  mutations: QueueMutations,
  engine: QueueEngine,
): void {
  app.get('/manage/orders/:number/diagnostics', async (request) => {
    sessions.require(request);
    const { number } = orderNumber.parse(request.params);
    return orderDiagnostic(repository, clients, number);
  });
  app.post('/manage/orders/:number/diagnostics/retry', async (request) => {
    sessions.require(request);
    const { number } = orderNumber.parse(request.params);
    const { expectedImageGenerations, ...action } = flowRetryActionSchema
      .extend({
        expectedImageGenerations: z
          .union([z.literal(0), z.literal(1)])
          .optional(),
      })
      .parse(request.body);
    const order = repository.get(number);
    const clientId = findTaskClientId(repository, order.id, action.taskId);
    const task = mutations.action(
      clientId,
      action,
      Date.now(),
      'orders',
      expectedImageGenerations,
    );
    const running =
      repository.database
        .prepare('SELECT running FROM queue_controls WHERE client_id=?')
        .get(clientId)?.running === 1;
    engine.wake();
    return { task, running };
  });
  app.post('/manage/orders/:number/diagnostics/resolve', async (request) => {
    sessions.require(request);
    const { number } = orderNumber.parse(request.params);
    const input = resolveSchema.parse(request.body);
    const order = repository.get(number);
    const clientId = findTaskClientId(repository, order.id, input.taskId);
    const task = mutations.action(
      clientId,
      {
        action: 'resolve',
        requestId: randomUUID(),
        taskId: input.taskId,
        expectedRevision: input.expectedRevision,
        outcome: input.outcome,
        note: input.note ?? 'Resolvido pelo operador no painel de pedidos.',
      },
      Date.now(),
      'orders',
    );
    engine.wake();
    return { task };
  });
  app.post('/manage/orders/:number/diagnostics/cancel', async (request) => {
    sessions.require(request);
    const { number } = orderNumber.parse(request.params);
    const input = cancelTaskSchema.parse(request.body);
    const order = repository.get(number);
    const clientId = findTaskClientId(repository, order.id, input.taskId);
    const task = mutations.action(
      clientId,
      {
        action: 'cancel',
        requestId: randomUUID(),
        taskId: input.taskId,
        expectedRevision: input.expectedRevision,
      },
      Date.now(),
      'orders',
    );
    engine.wake();
    return { task };
  });
}
