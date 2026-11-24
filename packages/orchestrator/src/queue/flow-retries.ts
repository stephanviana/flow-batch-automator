import type { FlowRetryAction } from '@flow-batch/protocol';
import type { QueueDatabase, TaskRecord } from './database.js';
import { FlowImages } from './flow-images.js';
import { HttpError } from '../security/errors.js';

export type RetryOrigin = 'orders' | 'extension';

export function orderRetryRestriction(
  database: QueueDatabase,
  taskId: string,
): string | undefined {
  const order = database.connection
    .prepare(
      `SELECT o.archived_at, x.dispatch_id AS closed
       FROM queue_tasks q JOIN order_dispatches d ON d.batch_id=q.batch_id
       JOIN production_orders o ON o.id=d.order_id
       LEFT JOIN dispatch_closures x ON x.dispatch_id=d.dispatch_id
       WHERE q.id=?`,
    )
    .get(taskId);
  if (order && order.archived_at !== null)
    return 'Este pedido foi removido da lista.';
  if (order?.closed) return 'Este grupo foi encerrado após revisão.';
}

export class FlowRetries {
  constructor(private readonly database: QueueDatabase) {}

  reason(record: TaskRecord): string | undefined {
    const { input, summary } = record;
    if (
      input.executor !== 'google-flow' ||
      !summary.attemptCount ||
      (summary.state !== 'failed' && summary.state !== 'uncertain')
    )
      return 'Somente takes com falha ou em revisão podem receber uma nova tentativa.';
    if (
      this.database.connection
        .prepare(
          "SELECT 1 FROM queue_checkpoints WHERE task_id=? AND stage IN ('video_ready','download_started') LIMIT 1",
        )
        .get(summary.id)
    )
      return 'O vídeo já foi localizado no Flow. Confira o projeto e os downloads.';
    const restriction = orderRetryRestriction(this.database, summary.id);
    if (restriction) return restriction;
    if (summary.lastError?.code === 'flow_unsafe_generation')
      return 'O Flow recusou o conteúdo. Solicite uma revisão no chat antes de autorizar uma nova versão.';
    const authorized = this.database.connection
      .prepare(
        'SELECT 1 FROM clients WHERE id=? AND authorized_at IS NOT NULL AND revoked_at IS NULL',
      )
      .get(record.clientId);
    if (!authorized) return 'A extensão deste take precisa estar autorizada.';
    if (input.flow.imageSourceTaskKey) {
      try {
        new FlowImages(this.database.connection).resolve(
          record.clientId,
          input,
        );
      } catch {
        return 'Conclua primeiro o take que gera a imagem de origem.';
      }
    }
  }

  schedule(
    record: TaskRecord,
    action: FlowRetryAction,
    now: number,
    origin: RetryOrigin,
  ): void {
    const reason = this.reason(record);
    if (reason) throw new HttpError(409, reason);
    const { id, state, attemptCount } = record.summary;
    const sql = this.database.connection;
    if (state === 'uncertain')
      this.database.change(
        record,
        'failed',
        now,
        'operator-flow-failure-confirmed',
      );
    this.database.change(
      this.database.task(id),
      'queued',
      now,
      'operator-flow-retry-authorized',
      {
        error: null,
        result: null,
        generationId: null,
      },
    );
    sql
      .prepare(
        `INSERT INTO queue_flow_retry_authorizations (task_id,attempt_number,input_hash,request_id,approved_at,origin)
       SELECT id,?,input_hash,?,?,? FROM queue_tasks WHERE id=?`,
      )
      .run(attemptCount + 1, action.requestId, now, origin, id);
    sql
      .prepare(
        'UPDATE queue_tasks SET max_attempts=?,next_attempt_at=? WHERE id=?',
      )
      .run(attemptCount + 1, now, id);
    if (action.startQueue)
      sql
        .prepare('UPDATE queue_controls SET running=1 WHERE client_id=?')
        .run(record.clientId);
  }

  approvalAt(record: TaskRecord, number: number): number | undefined {
    if (record.input.executor !== 'google-flow') return undefined;
    if (number === 1) return record.input.flow.approval.approvedAt;
    const authorization = this.database.connection
      .prepare(
        `SELECT r.approved_at FROM queue_flow_retry_authorizations r
       JOIN queue_tasks q ON q.id=r.task_id AND q.input_hash=r.input_hash
       WHERE r.task_id=? AND r.attempt_number=?`,
      )
      .get(record.summary.id, number);
    return typeof authorization?.approved_at === 'number'
      ? authorization.approved_at
      : undefined;
  }
}
