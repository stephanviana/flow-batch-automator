import type { OrderState, TaskDetail, TaskSummary } from '@flow-batch/protocol';
import type { ClientStore } from '../persistence/clients.js';
import {
  QueueDatabase,
  hasVideoSubmission,
  type TaskRecord,
} from '../queue/database.js';
import { FlowRetries } from '../queue/flow-retries.js';
import { FlowImages } from '../queue/flow-images.js';
import { HttpError } from '../security/errors.js';
import { DispatchRecovery, type DispatchReview } from './dispatch-recovery.js';
import type { OrderRepository, ProductionOrder } from './repository.js';

interface TaskDiagnostic {
  revisions: TaskDetail['revisions'];
  task: TaskSummary;
  projectId: string | null;
  events: TaskDetail['events'];
  checkpoints: { at: number; stage: string }[];
  retry: { images: number; videos: number } | null;
  retryBlockedReason: string | null;
  revisionBlockedReason: string | null;
  videoSubmitted: boolean;
  submissionReviewRequired: boolean;
  imageDependency: {
    take: string | null;
    state: TaskSummary['state'] | null;
  } | null;
}
export interface OrderDiagnostic {
  number: number;
  state: OrderState;
  preparation: { published: boolean; message: string };
  unavailableMaterials: string[];
  dispatches: {
    id: string;
    state: string;
    message: string;
    review: DispatchReview | null;
  }[];
  tasks: TaskDiagnostic[];
}

function preparationMessage(order: ProductionOrder, expired: boolean): string {
  if (order.preparation)
    return 'Preparação publicada e preservada com os materiais e parâmetros aprovados.';
  if (order.lease)
    return `Preparação reservada por ${order.lease.worker} até ${new Date(order.lease.expiresAt).toLocaleString('pt-BR')}. Nenhuma preparação foi publicada ainda.`;
  if (expired)
    return 'A reserva de preparação expirou sem publicação. Peça ao agente para consultar o pedido antes de preparar novamente.';
  if (order.state === 'cancelled')
    return 'O pedido foi cancelado antes da publicação da preparação.';
  return 'Nenhuma preparação foi publicada. Peça ao agente para preparar este pedido. Não há um erro de preparação registrado; consulte também a resposta do agente no chat.';
}

export function orderDiagnostic(
  repository: OrderRepository,
  clients: ClientStore,
  number: number,
): OrderDiagnostic {
  const order = repository.get(number);
  const lease = repository.database
    .prepare('SELECT lease_expires_at FROM production_orders WHERE id=?')
    .get(order.id);
  const expired = Boolean(
    lease?.lease_expires_at && Number(lease.lease_expires_at) <= Date.now(),
  );
  const recovery = new DispatchRecovery(repository, clients);
  const queue = new QueueDatabase(repository.database);
  const rows = repository.database
    .prepare(
      'SELECT q.id,q.client_id FROM queue_tasks q JOIN order_dispatches d ON d.batch_id=q.batch_id WHERE d.order_id=? ORDER BY q.sequence',
    )
    .all(order.id);
  return {
    number: order.number,
    state: order.state,
    preparation: {
      published: order.preparation !== null,
      message: preparationMessage(order, expired),
    },
    unavailableMaterials: order.materials
      .filter((material) => !material.available)
      .map((material) => material.name),
    dispatches: order.dispatches.map((dispatch) => ({
      ...dispatch,
      review:
        dispatch.state === 'blocked'
          ? recovery.review(number, dispatch.id)
          : null,
    })),
    tasks: rows.map((row) =>
      taskDiagnostic(queue, String(row.id), String(row.client_id)),
    ),
  };
}

function imageDependency(
  images: FlowImages,
  detail: TaskDetail,
  clientId: string,
): TaskDiagnostic['imageDependency'] {
  if (detail.task.state !== 'queued' || detail.input.executor !== 'google-flow')
    return null;
  try {
    const source = images.sourceTake(clientId, detail.input);
    return source && source.state !== 'completed'
      ? { take: source.take, state: source.state }
      : null;
  } catch (error) {
    if (error instanceof HttpError) return { take: null, state: null };
    throw error;
  }
}

function revisionBlock(
  retries: FlowRetries,
  record: TaskRecord,
): string | null {
  if (
    record.input.executor !== 'google-flow' ||
    record.summary.state !== 'failed'
  )
    return null;
  try {
    retries.revisionImage(record);
    return null;
  } catch (error) {
    if (error instanceof HttpError) return error.message;
    throw error;
  }
}

function taskDiagnostic(
  queue: QueueDatabase,
  id: string,
  clientId: string,
): TaskDiagnostic {
  const detail = queue.detail(id, clientId);
  const flow =
    detail.input.executor === 'google-flow' ? detail.input.flow : null;
  const record =
    flow && ['failed', 'uncertain'].includes(detail.task.state)
      ? queue.task(id, clientId)
      : undefined;
  const retries = new FlowRetries(queue);
  const images = new FlowImages(queue.connection);
  const blocked = record ? retries.reason(record) : undefined;
  return {
    revisions: detail.revisions,
    task: detail.task,
    projectId: flow?.projectId ?? null,
    retry:
      record && !blocked
        ? {
            images: images.forAttempt(record, detail.task.attemptCount + 1)
              ? 0
              : 1,
            videos: 1,
          }
        : null,
    retryBlockedReason: blocked ?? null,
    revisionBlockedReason: record ? revisionBlock(retries, record) : null,
    videoSubmitted: hasVideoSubmission(detail.task.step),
    submissionReviewRequired: record?.submissionReviewRequired ?? false,
    imageDependency: imageDependency(images, detail, clientId),
    events: detail.events,
    checkpoints: detail.checkpoints.map(({ at, checkpoint }) => ({
      at,
      stage: checkpoint.stage,
    })),
  };
}
