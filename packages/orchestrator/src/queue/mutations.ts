import {
  type QueueProgress,
  type QueueAction,
  type TaskSummary,
} from '@flow-batch/protocol';
import type { QueueDatabase, TaskRecord } from './database.js';
import { queueHash } from './repository.js';
import { HttpError } from '../security/errors.js';

export class QueueMutations {
  constructor(private readonly database: QueueDatabase) {}

  progress(
    clientId: string,
    connectionId: string,
    message: QueueProgress,
    now = Date.now(),
  ): boolean {
    return this.database.transaction(() => {
      const row = this.database.connection
        .prepare(
          'SELECT id FROM queue_tasks WHERE id=? AND client_id=? AND active_attempt_id=? AND connection_id=?',
        )
        .get(message.taskId, clientId, message.attemptId, connectionId);
      if (!row) return false; // A duplicate or an event fenced out by a newer attempt.
      const record = this.database.task(message.taskId, clientId);
      if ('error' in message) {
        if (message.state === 'uncertain') {
          this.database.change(
            record,
            'uncertain',
            now,
            'executor-outcome-unknown',
            {
              error: {
                ...message.error,
                retryable: false,
                notSubmitted: false,
              },
            },
          );
          this.database.connection
            .prepare('UPDATE queue_controls SET running=0 WHERE client_id=?')
            .run(clientId);
        } else this.failure(record, message.error, now);
        return true;
      }
      const order = [
        'dispatching',
        'submitted',
        'generating',
        'download_pending',
        'completed',
      ];
      if (order.indexOf(message.state) <= order.indexOf(record.summary.state))
        return false;
      if (
        record.summary.generationId &&
        record.summary.generationId !== message.generationId
      )
        throw new HttpError(
          409,
          'Generation identity changed within the attempt',
        );
      this.database.change(record, message.state, now, 'executor-progress', {
        generationId: message.generationId,
        ...(message.state === 'completed' ? { result: message.result } : {}),
      });
      if (message.state === 'submitted')
        this.database.connection
          .prepare('UPDATE queue_tasks SET deadline_at=? WHERE id=?')
          .run(
            now + record.input.simulation.durationMs + 10000,
            message.taskId,
          );
      return true;
    });
  }

  private failure(
    record: TaskRecord,
    error: NonNullable<TaskSummary['lastError']>,
    now: number,
  ): void {
    const safe = record.summary.state === 'dispatching' && error.notSubmitted;
    this.database.change(record, 'failed', now, 'executor-failed', {
      error,
      safeToRetry: safe,
    });
    if (
      safe &&
      error.retryable &&
      record.summary.attemptCount < record.summary.maxAttempts
    ) {
      const failed = this.database.task(record.summary.id);
      this.database.change(failed, 'queued', now, 'automatic-safe-retry', {
        error,
        safeToRetry: true,
      });
      this.database.connection
        .prepare('UPDATE queue_tasks SET next_attempt_at=? WHERE id=?')
        .run(
          now + Math.min(30000, 1000 * 2 ** (record.summary.attemptCount - 1)),
          record.summary.id,
        );
    }
  }

  interrupt(
    connectionId?: string,
    reason = 'connection-lost',
    now = Date.now(),
  ): void {
    this.database.transaction(() => {
      const rows = this.database.connection
        .prepare(
          `SELECT id FROM queue_tasks WHERE state IN ('dispatching','submitted','generating','download_pending')${connectionId ? ' AND connection_id=?' : ''}`,
        )
        .all(...(connectionId ? [connectionId] : []));
      for (const row of rows) {
        const record = this.database.task(String(row.id));
        this.database.change(record, 'uncertain', now, reason, {
          error: {
            code: 'result_uncertain',
            message: 'Execution outcome requires explicit review',
            retryable: false,
            notSubmitted: false,
          },
        });
        this.database.connection
          .prepare('UPDATE queue_controls SET running=0 WHERE client_id=?')
          .run(record.clientId);
      }
    });
  }

  action(clientId: string, action: QueueAction, now = Date.now()): TaskSummary {
    return this.database.transaction(() => {
      const sql = this.database.connection;
      const hash = queueHash(action);
      const previous = sql
        .prepare(
          'SELECT body_hash,task_id FROM queue_actions WHERE client_id=? AND request_id=?',
        )
        .get(clientId, action.requestId);
      if (previous) {
        if (previous.body_hash !== hash)
          throw new HttpError(
            409,
            'Action ID reused with different parameters',
          );
        return this.database.task(String(previous.task_id), clientId).summary;
      }
      const record = this.database.task(action.taskId, clientId);
      if (record.summary.revision !== action.expectedRevision)
        throw new HttpError(409, 'Task changed; refresh before acting');
      if (action.action === 'retry')
        this.retry(record, action.acknowledgeDuplicateRisk, now);
      else if (action.action === 'cancel')
        this.database.change(record, 'cancelled', now, 'operator-cancelled');
      else this.resolve(record, action, now);
      sql
        .prepare(
          'INSERT INTO queue_actions (client_id,request_id,body_hash,task_id) VALUES (?,?,?,?)',
        )
        .run(clientId, action.requestId, hash, action.taskId);
      return this.database.task(action.taskId, clientId).summary;
    });
  }

  private retry(record: TaskRecord, acknowledged: boolean, now: number): void {
    if (record.summary.state !== 'failed')
      throw new HttpError(409, 'Only failed, reviewed tasks can retry');
    if (record.summary.attemptCount >= record.summary.maxAttempts)
      throw new HttpError(409, 'Attempt budget exhausted');
    if (!record.summary.safeToRetry && !acknowledged)
      throw new HttpError(
        409,
        'Explicit duplicate-risk acknowledgement required',
      );
    this.database.change(
      record,
      'queued',
      now,
      acknowledged ? 'operator-retry-risk-acknowledged' : 'operator-safe-retry',
    );
    this.database.connection
      .prepare('UPDATE queue_tasks SET next_attempt_at=? WHERE id=?')
      .run(now, record.summary.id);
  }

  private resolve(
    record: TaskRecord,
    action: Extract<QueueAction, { action: 'resolve' }>,
    now: number,
  ): void {
    if (record.summary.state !== 'uncertain')
      throw new HttpError(409, 'Task does not require review');
    this.database.change(
      record,
      action.outcome === 'completed' ? 'completed' : 'failed',
      now,
      `operator-review:${action.outcome}:${action.note}`,
      {
        safeToRetry: action.outcome === 'not_submitted',
        error: null,
        ...(action.outcome === 'completed'
          ? {
              result: {
                simulated: true,
                outputFile: null,
                description: 'Completion acknowledged by operator (simulation)',
              },
            }
          : {}),
      },
    );
  }
}
