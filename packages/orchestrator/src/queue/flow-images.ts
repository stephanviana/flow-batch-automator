import type { DatabaseSync } from 'node:sqlite';
import {
  taskInputSchema,
  queueCheckpointSchema,
  taskStateSchema,
  type TaskInput,
  type FlowExecute,
  type TaskState,
} from '@flow-batch/protocol';
import { HttpError } from '../security/errors.js';
import type { TaskRecord } from './database.js';

type RealInput = Extract<TaskInput, { executor: 'google-flow' }>;
export class FlowImages {
  constructor(private readonly sql: DatabaseSync) {}

  sourceTake(
    clientId: string,
    input: RealInput,
  ): { id: string; take: string; state: TaskState } | undefined {
    if (!input.flow.imageSourceTaskKey) return undefined;
    const row = this.sql
      .prepare(
        'SELECT id,input,state FROM queue_tasks WHERE client_id=? AND task_key=?',
      )
      .get(clientId, input.flow.imageSourceTaskKey);
    if (!row)
      throw new HttpError(
        409,
        'Source image take must already exist for this owner',
      );
    const source = taskInputSchema.parse(
      JSON.parse(String(row.input)) as unknown,
    );
    if (
      source.executor !== 'google-flow' ||
      source.flow.imageSourceTaskKey ||
      !input.flow.batchId ||
      source.flow.batchId !== input.flow.batchId ||
      source.flow.projectId !== input.flow.projectId ||
      source.product !== input.product ||
      source.video !== input.video ||
      source.flow.imageModel !== input.flow.imageModel ||
      source.flow.aspect !== input.flow.aspect ||
      source.flow.output?.directory !== input.flow.output?.directory ||
      source.flow.output?.root !== input.flow.output?.root ||
      source.original.imagePrompt !== input.original.imagePrompt ||
      source.flow.reference.sha256 !== input.flow.reference.sha256 ||
      source.flow.reference.mime !== input.flow.reference.mime ||
      source.flow.reference.bytes !== input.flow.reference.bytes
    )
      throw new HttpError(
        409,
        'Source image must match the immutable visual materials, variation and project',
      );
    return {
      id: String(row.id),
      take: source.take,
      state: taskStateSchema.parse(row.state),
    };
  }

  resolve(clientId: string, input: RealInput): FlowExecute['sourceImage'] {
    const source = this.sourceTake(clientId, input);
    if (!source) return undefined;
    if (source.state !== 'completed')
      throw new HttpError(409, 'Source take must complete before image reuse');
    const row = this.sql
      .prepare(
        "SELECT payload FROM queue_checkpoints WHERE task_id=? AND stage='image_generated' ORDER BY sequence DESC LIMIT 1",
      )
      .get(source.id);
    if (!row) throw new HttpError(409, 'Source image checkpoint unavailable');
    const checkpoint = queueCheckpointSchema.parse(
      JSON.parse(String(row.payload)) as unknown,
    );
    if (checkpoint.stage !== 'image_generated')
      throw new HttpError(409, 'Source image checkpoint incompatible');
    return { taskId: source.id, mediaId: checkpoint.mediaId };
  }

  forAttempt(
    record: TaskRecord,
    number = record.summary.attemptCount,
  ): FlowExecute['sourceImage'] {
    if (record.input.executor !== 'google-flow') return undefined;
    if (record.input.flow.imageSourceTaskKey)
      return this.resolve(record.clientId, record.input);
    if (number < 2) return undefined;
    const row = this.sql
      .prepare(
        `SELECT c.payload FROM queue_checkpoints c
         JOIN queue_attempts a ON a.id=c.attempt_id AND a.task_id=c.task_id
         JOIN queue_tasks q ON q.id=c.task_id
         WHERE q.id=? AND q.client_id=? AND a.number<? AND c.stage='image_generated'
         ORDER BY a.number DESC LIMIT 1`,
      )
      .get(record.summary.id, record.clientId, number);
    if (!row) return undefined;
    const checkpoint = queueCheckpointSchema.parse(
      JSON.parse(String(row.payload)) as unknown,
    );
    if (checkpoint.stage !== 'image_generated')
      throw new HttpError(409, 'Prior image checkpoint incompatible');
    return { taskId: record.summary.id, mediaId: checkpoint.mediaId };
  }
}
