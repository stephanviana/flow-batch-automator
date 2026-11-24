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

const orderNumber = z.object({ number: z.coerce.number().int().positive() });

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
    const action = flowRetryActionSchema.parse(request.body);
    const order = repository.get(number);
    const sql = repository.database;
    const owner = sql
      .prepare(
        `SELECT q.client_id FROM queue_tasks q JOIN order_dispatches d ON d.batch_id=q.batch_id
       WHERE q.id=? AND d.order_id=?`,
      )
      .get(action.taskId, order.id);
    if (!owner) throw new HttpError(404, 'Take não encontrado neste pedido.');
    const clientId = String(owner.client_id);
    const task = mutations.action(clientId, action, Date.now(), 'orders');
    const running =
      sql
        .prepare('SELECT running FROM queue_controls WHERE client_id=?')
        .get(clientId)?.running === 1;
    engine.wake();
    return { task, running };
  });
}
