import type { DatabaseSync } from 'node:sqlite';
import {
  ACTIVE_TASK_STATES,
  canTransitionTask,
  taskInputSchema,
  taskSummarySchema,
  taskDetailSchema,
  type TaskInput,
  type TaskSummary,
  type TaskState,
  type TaskDetail,
} from '@flow-batch/protocol';
import { HttpError } from '../security/errors.js';

export interface TaskRecord {
  summary: TaskSummary;
  input: TaskInput;
  clientId: string;
  activeAttemptId: string | null;
  connectionId: string | null;
  deadlineAt: number | null;
}
export interface ChangeDetails {
  error?: TaskSummary['lastError'];
  result?: TaskSummary['result'];
  generationId?: string | null;
  safeToRetry?: boolean;
}
function json(value: unknown): unknown {
  return value === null || value === undefined
    ? null
    : (JSON.parse(String(value)) as unknown);
}

export class QueueDatabase {
  constructor(readonly connection: DatabaseSync) {}

  transaction<T>(operation: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  task(id: string, clientId?: string): TaskRecord {
    const row = this.connection
      .prepare(
        `SELECT * FROM queue_tasks WHERE id = ?${clientId ? ' AND client_id = ?' : ''}`,
      )
      .get(...(clientId ? [id, clientId] : [id]));
    if (!row) throw new HttpError(404, 'Task not found');
    const input = taskInputSchema.parse(json(row.input));
    const summary = taskSummarySchema.parse({
      id: row.id,
      taskKey: row.task_key,
      executor: input.executor,
      product: input.product,
      video: input.video,
      format: input.format,
      take: input.take,
      state: row.state,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      nextAttemptAt: row.next_attempt_at,
      generationId: row.generation_id,
      safeToRetry: row.safe_to_retry === 1,
      result: json(row.result),
      lastError: json(row.last_error),
    });
    return {
      summary,
      input,
      clientId: String(row.client_id),
      activeAttemptId:
        row.active_attempt_id === null ? null : String(row.active_attempt_id),
      connectionId:
        row.connection_id === null ? null : String(row.connection_id),
      deadlineAt: row.deadline_at === null ? null : Number(row.deadline_at),
    };
  }

  detail(id: string, clientId: string): TaskDetail {
    const record = this.task(id, clientId);
    const attempts = this.connection
      .prepare(
        'SELECT id,number,connection_id AS connectionId,started_at AS startedAt,finished_at AS finishedAt,state,generation_id AS generationId,error FROM queue_attempts WHERE task_id = ? ORDER BY number',
      )
      .all(id)
      .map((row) => ({ ...row, error: json(row.error) }));
    const events = this.connection
      .prepare(
        'SELECT state,at,attempt_id AS attemptId,reason,error FROM queue_events WHERE task_id = ? ORDER BY sequence',
      )
      .all(id)
      .map((row) => ({ ...row, error: json(row.error) }));
    return taskDetailSchema.parse({
      task: record.summary,
      input: record.input,
      attempts,
      events,
    });
  }

  event(
    id: string,
    state: TaskState,
    at: number,
    attemptId: string | null,
    reason: string,
    error: TaskSummary['lastError'] = null,
  ): void {
    this.connection
      .prepare(
        'INSERT INTO queue_events (task_id,state,at,attempt_id,reason,error) VALUES (?,?,?,?,?,?)',
      )
      .run(
        id,
        state,
        at,
        attemptId,
        reason,
        error === null ? null : JSON.stringify(error),
      );
  }

  change(
    record: TaskRecord,
    to: TaskState,
    now: number,
    reason: string,
    details: ChangeDetails = {},
  ): void {
    if (!canTransitionTask(record.summary.state, to))
      throw new HttpError(409, 'Invalid task transition');
    const active = ACTIVE_TASK_STATES.includes(to);
    const error =
      details.error === undefined ? record.summary.lastError : details.error;
    const result =
      details.result === undefined ? record.summary.result : details.result;
    const generationId =
      details.generationId === undefined
        ? record.summary.generationId
        : details.generationId;
    this.connection
      .prepare(
        'UPDATE queue_tasks SET state=?,updated_at=?,revision=revision+1,generation_id=?,result=?,last_error=?,safe_to_retry=?,active_attempt_id=?,connection_id=?,deadline_at=? WHERE id=?',
      )
      .run(
        to,
        now,
        generationId,
        result === null ? null : JSON.stringify(result),
        error === null ? null : JSON.stringify(error),
        Number(details.safeToRetry ?? false),
        active ? record.activeAttemptId : null,
        active ? record.connectionId : null,
        active ? record.deadlineAt : null,
        record.summary.id,
      );
    if (record.activeAttemptId)
      this.connection
        .prepare(
          'UPDATE queue_attempts SET state=?,finished_at=?,generation_id=?,error=? WHERE id=?',
        )
        .run(
          to,
          active ? null : now,
          generationId,
          error === null ? null : JSON.stringify(error),
          record.activeAttemptId,
        );
    this.event(
      record.summary.id,
      to,
      now,
      record.activeAttemptId,
      reason,
      error,
    );
  }
}
