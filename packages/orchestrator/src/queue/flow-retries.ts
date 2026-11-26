import { randomUUID } from 'node:crypto';
import type { FlowExecute, FlowRetryAction } from '@flow-batch/protocol';
import type { QueueDatabase, TaskRecord } from './database.js';
import { FlowImages } from './flow-images.js';
import { HttpError } from '../security/errors.js';
import { FlowRevisionStore } from './flow-revisions.js';

export type RetryOrigin = 'orders' | 'extension';
interface AutomaticRetryPolicy {
  id: string;
  approvedAt: number;
}
const AUTOMATIC_RETRY_DELAY_MS = 15_000;

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

  scheduleAutomatic(record: TaskRecord, now: number): boolean {
    const failed = this.database.task(record.summary.id, record.clientId);
    const { summary } = failed;
    if (
      failed.input.executor !== 'google-flow' ||
      summary.state !== 'failed' ||
      summary.attemptCount !== 1 ||
      !summary.safeToRetry ||
      !summary.lastError?.notSubmitted ||
      !summary.lastError.retryable ||
      this.reason(failed)
    )
      return false;
    const policy = this.automaticPolicy(failed, now);
    if (!policy) return false;
    this.schedule(
      failed,
      {
        action: 'retry_flow',
        requestId: randomUUID(),
        taskId: summary.id,
        expectedRevision: summary.revision,
        confirmedFailure: true,
        approve: true,
        startQueue: false,
      },
      now,
      'orders',
    );
    this.database.connection
      .prepare(
        'UPDATE queue_flow_retry_authorizations SET policy_id=?,approved_at=? WHERE task_id=? AND attempt_number=2',
      )
      .run(policy.id, policy.approvedAt, summary.id);
    this.database.connection
      .prepare('UPDATE queue_tasks SET next_attempt_at=? WHERE id=?')
      .run(now + AUTOMATIC_RETRY_DELAY_MS, summary.id);
    return true;
  }

  private automaticPolicy(
    record: TaskRecord,
    now: number,
  ): AutomaticRetryPolicy | undefined {
    const policy = this.database.connection
      .prepare(
        `SELECT p.id,p.authorized_at FROM order_auto_retry_authorizations p
       JOIN order_dispatches d ON d.order_id=p.order_id
       JOIN queue_tasks q ON q.batch_id=d.batch_id
       JOIN clients c ON c.id=q.client_id
       JOIN production_orders o ON o.id=d.order_id
       LEFT JOIN dispatch_closures x ON x.dispatch_id=d.dispatch_id
       WHERE q.id=? AND p.revoked_at IS NULL AND p.expires_at>?
         AND c.authorized_at IS NOT NULL AND c.revoked_at IS NULL
         AND o.archived_at IS NULL AND x.dispatch_id IS NULL
       ORDER BY p.authorized_at DESC LIMIT 1`,
      )
      .get(record.summary.id, now);
    return policy
      ? { id: String(policy.id), approvedAt: Number(policy.authorized_at) }
      : undefined;
  }

  reason(record: TaskRecord, revised = false): string | undefined {
    const { input, summary } = record;
    if (
      input.executor !== 'google-flow' ||
      !summary.attemptCount ||
      (summary.state !== 'failed' && summary.state !== 'uncertain')
    )
      return 'Somente takes com falha ou em revisão podem receber uma nova tentativa.';
    if (record.submissionReviewRequired)
      return 'O envio do vídeo foi confirmado. Confira o resultado no Flow e confirme a falha antes de solicitar uma nova tentativa.';
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
    if (!revised && summary.lastError?.code === 'flow_unsafe_generation')
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

  revisionImage(record: TaskRecord): NonNullable<FlowExecute['sourceImage']> {
    if (
      record.input.executor !== 'google-flow' ||
      record.summary.state !== 'failed'
    )
      throw new HttpError(409, 'A revisão exige um take com falha confirmada.');
    const reason = this.reason(record, true);
    if (reason) throw new HttpError(409, reason);
    const image = new FlowImages(this.database.connection).forAttempt(
      record,
      record.summary.attemptCount + 1,
    );
    if (!image)
      throw new HttpError(
        409,
        'Este take ainda não possui uma imagem confirmada para reutilizar.',
      );
    return image;
  }

  schedule(
    record: TaskRecord,
    action: FlowRetryAction,
    now: number,
    origin: RetryOrigin,
    revisionId?: string,
    expectedImageGenerations?: 0 | 1,
  ): void {
    const revisions = new FlowRevisionStore(this.database);
    if (revisionId) revisions.assertPending(record, revisionId);
    const reason = this.reason(record, Boolean(revisionId));
    if (reason) throw new HttpError(409, reason);
    if (expectedImageGenerations !== undefined)
      this.verifyRetryBudget(record, expectedImageGenerations);
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
        'UPDATE queue_flow_retry_authorizations SET revision_id=? WHERE task_id=? AND attempt_number=?',
      )
      .run(
        revisionId ?? revisions.previousId(record) ?? null,
        id,
        attemptCount + 1,
      );
    sql
      .prepare(
        'UPDATE queue_tasks SET max_attempts=?,next_attempt_at=? WHERE id=?',
      )
      .run(attemptCount + 1, now, id);
    if (action.startQueue)
      sql
        .prepare(
          'UPDATE queue_controls SET running=1 WHERE client_id=? AND operator_paused=0',
        )
        .run(record.clientId);
  }

  private verifyRetryBudget(record: TaskRecord, expected: 0 | 1): void {
    if (record.summary.state !== 'failed')
      throw new HttpError(
        409,
        'Confirme a falha no diagnóstico antes de autorizar outra tentativa.',
      );
    const image = new FlowImages(this.database.connection).forAttempt(
      record,
      record.summary.attemptCount + 1,
    );
    if ((image ? 0 : 1) !== expected)
      throw new HttpError(
        409,
        'O orçamento de imagens mudou. Consulte o diagnóstico e solicite nova autorização no chat.',
      );
  }

  approvalAt(
    record: TaskRecord,
    number: number,
    now = Date.now(),
  ): number | undefined {
    if (record.input.executor !== 'google-flow') return undefined;
    if (number === 1) return record.input.flow.approval.approvedAt;
    const authorization = this.database.connection
      .prepare(
        `SELECT r.approved_at FROM queue_flow_retry_authorizations r
       JOIN queue_tasks q ON q.id=r.task_id AND q.input_hash=r.input_hash
       LEFT JOIN order_auto_retry_authorizations p ON p.id=r.policy_id
       WHERE r.task_id=? AND r.attempt_number=?
         AND (r.policy_id IS NULL OR (p.revoked_at IS NULL AND p.expires_at>?))`,
      )
      .get(record.summary.id, number, now);
    return typeof authorization?.approved_at === 'number'
      ? authorization.approved_at
      : undefined;
  }
}
