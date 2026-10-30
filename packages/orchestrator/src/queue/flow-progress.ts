import {
  flowStageSchema,
  type QueueCheckpoint,
  type TaskSummary,
} from '@flow-batch/protocol';
import type { QueueDatabase, TaskRecord } from './database.js';
import { HttpError } from '../security/errors.js';

export class FlowProgress {
  constructor(private readonly database: QueueDatabase) {}

  checkpoint(
    clientId: string,
    connectionId: string,
    message: QueueCheckpoint,
    now: number,
  ): boolean {
    return this.database.transaction(() => {
      const record = this.database.task(message.taskId, clientId);
      if (
        record.activeAttemptId !== message.attemptId ||
        record.connectionId !== connectionId
      )
        return false;
      if (record.input.executor !== 'google-flow')
        throw new HttpError(409, 'Flow checkpoint on simulated task');
      const sql = this.database.connection;
      const previous = sql
        .prepare(
          'SELECT stage,payload FROM queue_checkpoints WHERE attempt_id=? ORDER BY sequence',
        )
        .all(message.attemptId);
      const duplicate = previous.find((row) => row.stage === message.stage);
      if (duplicate) {
        if (duplicate.payload !== JSON.stringify(message))
          throw new HttpError(409, 'Checkpoint identity changed');
        return false;
      }
      if (flowStageSchema.options[previous.length] !== message.stage)
        throw new HttpError(409, 'Checkpoint out of order');
      const expectedState =
        message.stage === 'reference_uploaded'
          ? 'submitted'
          : message.stage === 'download_started'
            ? 'download_pending'
            : 'generating';
      if (record.summary.state !== expectedState)
        throw new HttpError(409, 'Checkpoint does not match task state');
      sql
        .prepare(
          'INSERT INTO queue_checkpoints (task_id,attempt_id,stage,at,payload) VALUES (?,?,?,?,?)',
        )
        .run(
          message.taskId,
          message.attemptId,
          message.stage,
          now,
          JSON.stringify(message),
        );
      sql
        .prepare(
          'UPDATE queue_tasks SET revision=revision+1,updated_at=? WHERE id=?',
        )
        .run(now, message.taskId);
      this.database.event(
        message.taskId,
        record.summary.state,
        now,
        message.attemptId,
        `flow:${message.stage}`,
      );
      return true;
    });
  }

  validateCompletion(
    record: TaskRecord,
    result: NonNullable<TaskSummary['result']>,
  ): void {
    if (record.input.executor === 'simulation') {
      if (!result.simulated)
        throw new HttpError(409, 'Simulation cannot complete with real output');
      return;
    }
    if (result.simulated)
      throw new HttpError(409, 'Real task requires download evidence');
    const checkpoints = this.database
      .detail(record.summary.id, record.clientId)
      .checkpoints.filter(
        (entry) => entry.checkpoint.attemptId === record.activeAttemptId,
      );
    const fields = new Map(
      checkpoints.map(({ checkpoint }) => [checkpoint.stage, checkpoint]),
    );
    const image = fields.get('image_generated');
    const operation = fields.get('video_submitted');
    const video = fields.get('video_ready');
    const download = fields.get('download_started');
    if (
      checkpoints.length !== 5 ||
      image?.stage !== 'image_generated' ||
      image.mediaId !== result.imageMediaId ||
      operation?.stage !== 'video_submitted' ||
      operation.operationId !== result.operationId ||
      video?.stage !== 'video_ready' ||
      video.mediaId !== result.videoMediaId ||
      download?.stage !== 'download_started' ||
      download.downloadId !== result.downloadId ||
      result.outputFile !== `FlowBatch/${record.summary.id}/take.mp4`
    )
      throw new HttpError(
        409,
        'Completion evidence does not match checkpoints',
      );
  }
}
