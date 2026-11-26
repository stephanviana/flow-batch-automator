import {
  ACTIVE_TASK_STATES,
  flowResultSchema,
  type OrderState,
  type TaskSummary,
} from '@flow-batch/protocol';
import type { ConnectionHub } from '../communication/sockets.js';
import type { QueueRepository } from '../queue/repository.js';
import type { OrderRepository, ProductionOrder } from './repository.js';

type MonitoringStatus =
  | 'in_progress'
  | 'completed'
  | 'needs_review'
  | 'paused'
  | 'executor_disconnected'
  | 'not_dispatched'
  | 'cancelled';

interface ConfirmedDownload {
  take: string;
  outputFile: string;
}

interface PendingExecutor {
  clientId: string;
  canStart: boolean;
}

export interface OrderMonitoringSnapshot {
  orderId: string;
  number: number;
  state: OrderState;
  status: MonitoringStatus;
  reason: string | null;
  counts: ProductionOrder['counts'];
  expectedDownloads: number;
  confirmedDownloads: ConfirmedDownload[];
  activeTake: Pick<
    TaskSummary,
    'id' | 'product' | 'video' | 'take' | 'state' | 'step'
  > | null;
}

function confirmedDownloads(
  repo: OrderRepository,
  orderId: string,
): ConfirmedDownload[] {
  const rows = repo.database
    .prepare(
      `SELECT q.result, json_extract(q.input, '$.take') AS take FROM queue_tasks q
     JOIN order_dispatches d ON d.batch_id=q.batch_id
     WHERE d.order_id=? AND q.state='completed' AND json_extract(q.input, '$.executor')='google-flow'
     ORDER BY q.sequence`,
    )
    .all(orderId);
  return rows.flatMap((row) => {
    const result = flowResultSchema.safeParse(
      JSON.parse(String(row.result)) as unknown,
    );
    return result.success && typeof row.take === 'string'
      ? [{ take: row.take, outputFile: result.data.outputFile }]
      : [];
  });
}

function pendingExecutors(
  repo: OrderRepository,
  orderId: string,
): PendingExecutor[] {
  return repo.database
    .prepare(
      `SELECT c.client_id, MAX(c.state='pending' OR COALESCE(control.running,0)=1) AS can_start
     FROM order_dispatches d
     JOIN dispatch_commands c ON c.id=d.dispatch_id
     LEFT JOIN queue_controls control ON control.client_id=c.client_id
     WHERE d.order_id=? AND
       (c.state='pending' OR EXISTS (SELECT 1 FROM queue_tasks q
          WHERE q.batch_id=d.batch_id AND q.state='queued'))
     GROUP BY c.client_id`,
    )
    .all(orderId)
    .map((row) => ({
      clientId: String(row.client_id),
      canStart: row.can_start === 1,
    }));
}

function monitoringStatus(
  order: ProductionOrder,
  queue: QueueRepository,
  hub: ConnectionHub,
  pending: PendingExecutor[],
  snapshot: Pick<
    OrderMonitoringSnapshot,
    'expectedDownloads' | 'confirmedDownloads' | 'activeTake'
  >,
): Pick<OrderMonitoringSnapshot, 'status' | 'reason'> {
  if (order.state === 'completed') {
    if (
      snapshot.expectedDownloads > 0 &&
      snapshot.confirmedDownloads.length === snapshot.expectedDownloads
    )
      return { status: 'completed', reason: null };
    return {
      status: 'needs_review',
      reason:
        'Os downloads confirmados são insuficientes para concluir o pedido inteiro.',
    };
  }
  if (order.state === 'cancelled')
    return { status: 'cancelled', reason: 'O pedido foi cancelado.' };
  if (
    ['uncertain', 'blocked', 'failed'].includes(order.state) ||
    order.counts.failed
  )
    return {
      status: 'needs_review',
      reason:
        'Há falha ou resultado incerto no pedido. Consulte o diagnóstico.',
    };
  if (!order.dispatches.length)
    return {
      status: 'not_dispatched',
      reason: 'O pedido ainda não foi despachado.',
    };
  if (queue.blocked())
    return {
      status: 'needs_review',
      reason:
        'A fila está bloqueada por um resultado incerto. Consulte flow_queue_status.',
    };
  if (!snapshot.activeTake && pending.length) {
    const connected = pending.filter(({ clientId }) => hub.connected(clientId));
    if (!connected.length)
      return {
        status: 'executor_disconnected',
        reason: 'O executor vinculado ao trabalho pendente está desconectado.',
      };
    if (
      connected.every(
        ({ clientId, canStart }) => !canStart || queue.operatorPaused(clientId),
      )
    )
      return {
        status: 'paused',
        reason:
          'A fila aguarda retomada para iniciar o trabalho pendente deste pedido.',
      };
  }
  return { status: 'in_progress', reason: null };
}

export function monitorOrder(
  repo: OrderRepository,
  queue: QueueRepository,
  hub: ConnectionHub,
  key: string | number,
): OrderMonitoringSnapshot {
  const order = repo.get(key);
  const active = repo.database
    .prepare(
      `SELECT q.id FROM queue_tasks q JOIN order_dispatches d ON d.batch_id=q.batch_id
     WHERE d.order_id=? AND q.state IN (${ACTIVE_TASK_STATES.map(() => '?').join(',')}) LIMIT 1`,
    )
    .get(order.id, ...ACTIVE_TASK_STATES);
  const task = active ? queue.database.task(String(active.id)).summary : null;
  const snapshot = {
    activeTake: task && {
      id: task.id,
      product: task.product,
      video: task.video,
      take: task.take,
      state: task.state,
      step: task.step,
    },
    expectedDownloads:
      order.preparation?.manifests.reduce(
        (sum, manifest) => sum + manifest.tasks.length,
        0,
      ) ?? 0,
    confirmedDownloads: confirmedDownloads(repo, order.id),
  };
  return {
    orderId: order.id,
    number: order.number,
    state: order.state,
    counts: order.counts,
    ...snapshot,
    ...monitoringStatus(
      order,
      queue,
      hub,
      pendingExecutors(repo, order.id),
      snapshot,
    ),
  };
}
