import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { LocalSessions } from '../security/local-session.js';
import type { OrderRepository } from '../orders/repository.js';
import type { ClientStore } from '../persistence/clients.js';
import { orderDiagnostic } from '../orders/diagnostics.js';

export function registerOrderDiagnostics(
  app: FastifyInstance,
  sessions: LocalSessions,
  repository: OrderRepository,
  clients: ClientStore,
): void {
  app.get('/manage/orders/:number/diagnostics', async (request) => {
    sessions.require(request);
    const { number } = z
      .object({ number: z.coerce.number().int().positive() })
      .parse(request.params);
    return orderDiagnostic(repository, clients, number);
  });
}
