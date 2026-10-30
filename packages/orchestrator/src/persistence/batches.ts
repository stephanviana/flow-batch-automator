import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  batchSchema,
  type Batch,
  type BatchAction,
} from '@flow-batch/protocol';
import { HttpError } from '../security/errors.js';

export class BatchStore {
  constructor(private readonly database: DatabaseSync) {}

  interrupt(): void {
    this.database
      .prepare(
        "UPDATE flow_batches SET status='uncertain',revision=revision+1,updated_at=? WHERE status='creating'",
      )
      .run(Date.now());
  }

  get(clientId: string, id: string): Batch {
    const row = this.database
      .prepare(
        'SELECT id,name,mode,status,project_id AS projectId,project_title AS projectTitle,revision,created_at AS createdAt,updated_at AS updatedAt FROM flow_batches WHERE id=? AND client_id=?',
      )
      .get(id, clientId);
    if (!row) throw new HttpError(404, 'Batch not found');
    return batchSchema.parse(row);
  }

  list(clientId: string): Batch[] {
    return this.database
      .prepare(
        'SELECT id FROM flow_batches WHERE client_id=? ORDER BY created_at DESC,id',
      )
      .all(clientId)
      .map((row) => this.get(clientId, String(row.id)));
  }

  action(
    clientId: string,
    input: BatchAction,
  ): { batch: Batch; attemptId?: string } {
    if (input.action === 'prepare') {
      this.prepare(clientId, input);
      return { batch: this.get(clientId, input.draft.id) };
    }
    const batch = this.get(clientId, input.id);
    if (input.action === 'settle') this.settle(clientId, batch, input);
    else if (input.action === 'attach') this.attach(clientId, batch, input);
    else {
      if (batch.status !== 'draft' || batch.mode !== 'new-project')
        return { batch };
      this.checkRevision(batch, input.expectedRevision);
      const attemptId = randomUUID();
      this.database
        .prepare(
          "UPDATE flow_batches SET status='creating',creation_attempt_id=?,revision=revision+1,updated_at=? WHERE id=? AND client_id=?",
        )
        .run(attemptId, Date.now(), batch.id, clientId);
      return { batch: this.get(clientId, batch.id), attemptId };
    }
    return { batch: this.get(clientId, batch.id) };
  }

  private prepare(
    clientId: string,
    input: Extract<BatchAction, { action: 'prepare' }>,
  ): void {
    const { id, name, mode } = input.draft;
    const existing = this.database
      .prepare('SELECT client_id,name,mode FROM flow_batches WHERE id=?')
      .get(id);
    if (existing) {
      if (
        existing.client_id !== clientId ||
        existing.name !== name ||
        existing.mode !== mode
      )
        throw new HttpError(409, 'Batch ID reused with different input');
      return;
    }
    const now = Date.now();
    this.database
      .prepare(
        "INSERT INTO flow_batches (id,client_id,name,mode,status,created_at,updated_at) VALUES (?,?,?,?,'draft',?,?)",
      )
      .run(id, clientId, name, mode, now, now);
  }

  private checkRevision(batch: Batch, expected: number): void {
    if (batch.revision !== expected) throw new HttpError(409, 'Batch changed');
  }

  private attach(
    clientId: string,
    batch: Batch,
    input: Extract<BatchAction, { action: 'attach' }>,
  ): void {
    if (batch.status === 'ready') {
      if (batch.projectId !== input.projectId)
        throw new HttpError(409, 'Batch project is immutable');
      return;
    }
    this.checkRevision(batch, input.expectedRevision);
    this.database
      .prepare(
        "UPDATE flow_batches SET status='ready',project_id=?,creation_attempt_id=NULL,revision=revision+1,updated_at=? WHERE id=? AND client_id=?",
      )
      .run(input.projectId, Date.now(), batch.id, clientId);
  }

  private settle(
    clientId: string,
    batch: Batch,
    input: Extract<BatchAction, { action: 'settle' }>,
  ): void {
    const row = this.database
      .prepare(
        'SELECT creation_attempt_id FROM flow_batches WHERE id=? AND client_id=?',
      )
      .get(batch.id, clientId);
    if (row?.creation_attempt_id !== input.attemptId)
      throw new HttpError(409, 'Creation attempt changed');
    if (batch.status === 'ready') {
      if (input.outcome === 'ready' && batch.projectId === input.projectId)
        return;
      throw new HttpError(409, 'Batch project is immutable');
    }
    if (!['creating', 'uncertain'].includes(batch.status))
      throw new HttpError(409, 'No creation pending');
    // Only a proven successful response can settle a creation interrupted by restart.
    if (batch.status === 'uncertain' && input.outcome !== 'ready') return;
    this.database
      .prepare(
        'UPDATE flow_batches SET status=?,project_id=?,project_title=?,revision=revision+1,updated_at=? WHERE id=? AND client_id=?',
      )
      .run(
        input.outcome === 'not-created' ? 'draft' : input.outcome,
        input.projectId ?? null,
        input.projectTitle ?? null,
        Date.now(),
        batch.id,
        clientId,
      );
  }
}
