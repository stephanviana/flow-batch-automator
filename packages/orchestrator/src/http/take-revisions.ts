import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  flowRevisionApprovalSchema,
  flowRevisionSubmissionSchema,
} from '@flow-batch/protocol';
import type { LocalSessions } from '../security/local-session.js';
import type { OrderRepository } from '../orders/repository.js';
import type { LibraryStore } from '../library/store.js';
import type { QueueEngine } from '../queue/engine.js';
import { TakeRevisions } from '../orders/take-revisions.js';

export function registerTakeRevisions(
  app: FastifyInstance,
  sessions: LocalSessions,
  orders: OrderRepository,
  library: LibraryStore,
  engine: QueueEngine,
): void {
  const revisions = new TakeRevisions(orders, library);
  const taskId = (params: unknown): string =>
    z.object({ taskId: z.uuid() }).parse(params).taskId;
  app.get('/manage/takes/:taskId/review', async (request) => {
    sessions.require(request);
    return revisions.review(taskId(request.params));
  });
  app.post('/manage/takes/:taskId/revisions', async (request) => {
    sessions.require(request);
    const revision = await revisions.prepare(
      taskId(request.params),
      flowRevisionSubmissionSchema.parse(request.body),
    );
    if (revision.approvedAt !== null) engine.wake();
    return revision;
  });
  app.post('/manage/takes/:taskId/revisions/approve', async (request) => {
    sessions.require(request);
    const revision = revisions.approve(
      taskId(request.params),
      flowRevisionApprovalSchema.parse(request.body),
    );
    engine.wake();
    return revision;
  });
}
