import type { DatabaseSync } from 'node:sqlite';
import {
  taskInputSchema,
  queueCheckpointSchema,
  type TaskInput,
  type FlowExecute,
} from '@flow-batch/protocol';
import { HttpError } from '../security/errors.js';

type RealInput = Extract<TaskInput, { executor: 'google-flow' }>;
export class FlowImages {
  constructor(private readonly sql: DatabaseSync) {}

  assertSource(clientId: string, input: RealInput): string | undefined {
    if (!input.flow.imageSourceTaskKey) return undefined;
    const row = this.sql
      .prepare(
        'SELECT id,input FROM queue_tasks WHERE client_id=? AND task_key=?',
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
      source.original.imagePrompt !== input.original.imagePrompt ||
      source.flow.reference.sha256 !== input.flow.reference.sha256 ||
      source.flow.reference.mime !== input.flow.reference.mime ||
      source.flow.reference.bytes !== input.flow.reference.bytes
    )
      throw new HttpError(
        409,
        'Source image must match the immutable visual materials, variation and project',
      );
    return String(row.id);
  }

  resolve(clientId: string, input: RealInput): FlowExecute['sourceImage'] {
    const id = this.assertSource(clientId, input);
    if (!id) return undefined;
    const source = this.sql
      .prepare('SELECT state FROM queue_tasks WHERE id=?')
      .get(id);
    if (source?.state !== 'completed')
      throw new HttpError(409, 'Source take must complete before image reuse');
    const row = this.sql
      .prepare(
        "SELECT payload FROM queue_checkpoints WHERE task_id=? AND stage='image_generated' ORDER BY sequence DESC LIMIT 1",
      )
      .get(id);
    if (!row) throw new HttpError(409, 'Source image checkpoint unavailable');
    const checkpoint = queueCheckpointSchema.parse(
      JSON.parse(String(row.payload)) as unknown,
    );
    if (checkpoint.stage !== 'image_generated')
      throw new HttpError(409, 'Source image checkpoint incompatible');
    return { taskId: id, mediaId: checkpoint.mediaId };
  }
}
