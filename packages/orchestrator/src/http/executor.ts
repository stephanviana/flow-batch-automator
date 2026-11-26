import { BROWSER_EXECUTOR_ID } from '@flow-batch/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ConnectionHub } from '../communication/sockets.js';
import type { ClientStore } from '../persistence/clients.js';
import type { QueueEngine } from '../queue/engine.js';
import type { QueueRepository } from '../queue/repository.js';
import { HttpError } from '../security/errors.js';
import type { LocalSessions } from '../security/local-session.js';

interface ManagedExecutorClient {
  id: string;
  extensionId: string;
  revokedAt: number | null;
}

function selectManagedClient(
  active: ManagedExecutorClient[],
  requestedId?: string,
  requireSelection = false,
): ManagedExecutorClient | null {
  if (requestedId) {
    const match = active.find((client) => client.id === requestedId);
    if (!match) throw new HttpError(404, 'Executor autorizado não encontrado.');
    return match;
  }
  if (requireSelection && active.length > 1)
    throw new HttpError(
      409,
      'Há mais de um executor autorizado. Selecione o destino.',
    );
  const browserClients = active.filter(
    (client) => client.extensionId === BROWSER_EXECUTOR_ID,
  );
  if (browserClients.length === 1) return browserClients[0]!;
  return active.length === 1 ? active[0]! : null;
}

function authorizedExecutors(clients: ClientStore): ManagedExecutorClient[] {
  return (clients.managementStatus().clients as ManagedExecutorClient[]).filter(
    (client) => client.revokedAt === null,
  );
}

function queueCounts(repository: QueueRepository): {
  queued: number;
  active: number;
  uncertain: number;
  completed: number;
  failed: number;
  cancelled: number;
} {
  const counts = {
    queued: 0,
    active: 0,
    uncertain: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  const rows = repository.database.connection
    .prepare('SELECT state, COUNT(*) AS count FROM queue_tasks GROUP BY state')
    .all();
  for (const row of rows) {
    const state = String(row.state);
    const count = Number(row.count);
    if (
      ['dispatching', 'submitted', 'generating', 'download_pending'].includes(
        state,
      )
    )
      counts.active += count;
    else if (state in counts) counts[state as keyof typeof counts] += count;
  }
  return counts;
}

function executorSnapshot(
  clients: ClientStore,
  hub: ConnectionHub,
  repository: QueueRepository,
  clientId?: string,
): {
  executor: ExecutorState | null;
  executors: ExecutorState[];
  blockedByReview: boolean;
  counts: ReturnType<typeof queueCounts>;
} {
  const active = authorizedExecutors(clients);
  const client = selectManagedClient(active, clientId);
  const executors = active.map((entry) =>
    executorState(entry, repository, hub),
  );
  return {
    executor: executors.find(({ id }) => id === client?.id) ?? null,
    executors,
    blockedByReview: repository.blocked(),
    counts: queueCounts(repository),
  };
}

interface ExecutorState {
  id: string;
  extensionId: string;
  connected: boolean;
  running: boolean;
  paused: boolean;
  pendingDispatches: number;
}

function executorState(
  client: ManagedExecutorClient,
  repository: QueueRepository,
  hub: ConnectionHub,
): ExecutorState {
  const sql = repository.database.connection;
  return {
    id: client.id,
    extensionId: client.extensionId,
    connected: hub.connected(client.id),
    running:
      sql
        .prepare('SELECT running FROM queue_controls WHERE client_id=?')
        .get(client.id)?.running === 1,
    paused: repository.operatorPaused(client.id),
    pendingDispatches: Number(
      sql
        .prepare(
          "SELECT COUNT(*) AS total FROM dispatch_commands WHERE client_id=? AND state='pending'",
        )
        .get(client.id)?.total ?? 0,
    ),
  };
}

export function registerExecutorManagement(
  app: FastifyInstance,
  sessions: LocalSessions,
  clients: ClientStore,
  hub: ConnectionHub,
  repository: QueueRepository,
  engine: QueueEngine,
): void {
  app.get('/manage/executor', async (request) => {
    sessions.require(request);
    const { clientId } = z
      .strictObject({ clientId: z.uuid().optional() })
      .parse(request.query);
    return executorSnapshot(clients, hub, repository, clientId);
  });

  app.post('/manage/executor/control', async (request) => {
    sessions.require(request);
    const input = z
      .strictObject({
        action: z.enum(['start', 'pause']),
        clientId: z.uuid().optional(),
      })
      .parse(request.body);
    const client = selectManagedClient(
      authorizedExecutors(clients),
      input.clientId,
      true,
    );
    if (!client)
      throw new HttpError(
        409,
        'Nenhum executor MCP autorizado. Conecte em /connect.',
      );
    repository.control(client.id, input.action === 'start');
    engine.wake();
    return executorSnapshot(clients, hub, repository, client.id);
  });
}
