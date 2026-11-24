import {
  flowTakeRevisionSchema,
  type FlowTakeRevision,
  type TaskInput,
} from '@flow-batch/protocol';
import type { QueueDatabase, TaskRecord } from './database.js';
import { HttpError } from '../security/errors.js';

export class FlowRevisionStore {
  constructor(private readonly database: QueueDatabase) {}

  list(taskId: string): FlowTakeRevision[] {
    return this.database.connection
      .prepare(
        `SELECT v.*,r.approved_at,r.attempt_number FROM queue_flow_revisions v
       LEFT JOIN queue_flow_retry_authorizations r ON r.revision_id=v.id
         AND r.attempt_number=(SELECT MIN(a.attempt_number) FROM queue_flow_retry_authorizations a WHERE a.revision_id=v.id)
       WHERE v.task_id=? ORDER BY v.created_at,v.rowid`,
      )
      .all(taskId)
      .map((row) =>
        flowTakeRevisionSchema.parse({
          id: row.id,
          taskId: row.task_id,
          baseAttemptId: row.base_attempt_id,
          taskRevision: row.task_revision,
          contentHash: row.content_hash,
          content: JSON.parse(String(row.content)) as unknown,
          sourceImage: JSON.parse(String(row.source_image)) as unknown,
          createdAt: row.created_at,
          approvedAt: row.approved_at ?? null,
          attemptNumber: row.attempt_number ?? null,
        }),
      );
  }

  get(taskId: string, id: string): FlowTakeRevision {
    const revision = this.list(taskId).find((entry) => entry.id === id);
    if (!revision) throw new HttpError(404, 'Versão do take não encontrada.');
    return revision;
  }

  previousId(record: TaskRecord): string | undefined {
    const row = this.database.connection
      .prepare(
        'SELECT revision_id FROM queue_flow_retry_authorizations WHERE task_id=? AND attempt_number<=? ORDER BY attempt_number DESC LIMIT 1',
      )
      .get(record.summary.id, record.summary.attemptCount);
    return typeof row?.revision_id === 'string' ? row.revision_id : undefined;
  }

  original(
    record: TaskRecord,
    number = record.summary.attemptCount,
  ): TaskInput['original'] {
    const row = this.database.connection
      .prepare(
        'SELECT revision_id FROM queue_flow_retry_authorizations WHERE task_id=? AND attempt_number=?',
      )
      .get(record.summary.id, number);
    if (!row?.revision_id) return record.input.original;
    const revision = this.get(record.summary.id, String(row.revision_id));
    return {
      ...record.input.original,
      copy: revision.content.copy,
      videoPrompt: revision.content.videoPrompt,
    };
  }

  assertPending(record: TaskRecord, id: string): FlowTakeRevision {
    const revision = this.get(record.summary.id, id);
    const row = this.database.connection
      .prepare(
        'SELECT v.id FROM queue_flow_revisions v JOIN queue_tasks q ON q.id=v.task_id AND q.input_hash=v.input_hash WHERE v.id=?',
      )
      .get(id);
    if (
      !row ||
      revision.approvedAt !== null ||
      revision.taskRevision !== record.summary.revision
    )
      throw new HttpError(
        409,
        'O take mudou. Consulte o diagnóstico e prepare uma nova versão.',
      );
    return revision;
  }
}
