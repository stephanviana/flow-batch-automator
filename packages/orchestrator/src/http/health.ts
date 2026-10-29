import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import type { Readiness } from '@flow-batch/protocol';
import { isDatabaseReady } from '../persistence/database.js';

export function registerHealth(
  app: FastifyInstance,
  database: DatabaseSync,
): void {
  app.get('/health/live', async () => ({ status: 'alive' as const }));
  app.get('/health', async (_request, reply): Promise<Readiness> => {
    if (isDatabaseReady(database))
      return { status: 'ready', sqlite: 'available' };
    reply.code(503);
    return { status: 'unavailable', sqlite: 'unavailable' };
  });
}
