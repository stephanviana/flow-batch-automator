import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { LocalSessions } from '../security/local-session.js';
import type { OrderRepository } from '../orders/repository.js';
import type { ClientStore } from '../persistence/clients.js';
import { DispatchClosure } from '../orders/dispatch-closure.js';
import { DispatchRecovery } from '../orders/dispatch-recovery.js';

export function registerDispatchRecovery(
  app: FastifyInstance,
  sessions: LocalSessions,
  repository: OrderRepository,
  clients: ClientStore,
): void {
  const recovery = new DispatchRecovery(repository, clients);
  const target = z.object({
    number: z.coerce.number().int().positive(),
    dispatchId: z.uuid(),
  });
  app.get(
    '/manage/orders/:number/dispatches/:dispatchId/review',
    async (request) => {
      sessions.require(request);
      const { number, dispatchId } = target.parse(request.params);
      return recovery.review(number, dispatchId);
    },
  );
  app.post(
    '/manage/orders/:number/dispatches/:dispatchId/close',
    async (request) => {
      sessions.require(request);
      const { number, dispatchId } = target.parse(request.params);
      const input = z
        .strictObject({
          reviewed: z.literal(true).optional(),
          reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
          preparationHash: z.string().regex(/^[a-f0-9]{64}$/),
          note: z.string().trim().min(1).max(500).optional(),
        })
        .parse(request.body);
      return new DispatchClosure(repository, clients).close(
        number,
        dispatchId,
        input,
      );
    },
  );
  app.post(
    '/manage/orders/:number/dispatches/:dispatchId/resume',
    async (request) => {
      sessions.require(request);
      const { number, dispatchId } = target.parse(request.params);
      const input = z
        .strictObject({
          userAuthorized: z.literal(true),
          reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
          preparationHash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .parse(request.body);
      return recovery.resume(
        number,
        dispatchId,
        input.reviewHash,
        input.preparationHash,
      );
    },
  );
}
