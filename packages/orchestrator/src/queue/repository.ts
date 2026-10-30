import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  taskStateSchema,
  queueSnapshotSchema,
  type TaskInput,
  type TaskSummary,
  type QueueSnapshot,
} from '@flow-batch/protocol';
import type { QueueDatabase, TaskRecord } from './database.js';
import { HttpError } from '../security/errors.js';

export function queueHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class QueueRepository {
  constructor(readonly database: QueueDatabase) {}

  enqueue(
    clientId: string,
    requestId: string,
    tasks: TaskInput[],
    now = Date.now(),
  ): TaskSummary[] {
    const sql = this.database.connection;
    return this.database.transaction(() => {
      const hash = queueHash(tasks);
      const previous = sql
        .prepare(
          'SELECT body_hash,task_ids FROM queue_requests WHERE client_id=? AND request_id=?',
        )
        .get(clientId, requestId);
      if (previous) {
        if (previous.body_hash !== hash)
          throw new HttpError(409, 'Request ID reused with different tasks');
        return z
          .array(z.uuid())
          .parse(JSON.parse(String(previous.task_ids)))
          .map((id) => this.database.task(id, clientId).summary);
      }
      sql
        .prepare('INSERT OR IGNORE INTO queue_controls (client_id) VALUES (?)')
        .run(clientId);
      const ids = tasks.map((input) => this.insert(clientId, input, now));
      sql
        .prepare(
          'INSERT INTO queue_requests (client_id,request_id,body_hash,task_ids) VALUES (?,?,?,?)',
        )
        .run(clientId, requestId, hash, JSON.stringify(ids));
      return ids.map((id) => this.database.task(id, clientId).summary);
    });
  }

  private insert(clientId: string, input: TaskInput, now: number): string {
    const sql = this.database.connection;
    const hash = queueHash(input);
    const existing = sql
      .prepare(
        'SELECT id,input_hash FROM queue_tasks WHERE client_id=? AND task_key=?',
      )
      .get(clientId, input.taskKey);
    if (existing) {
      if (existing.input_hash !== hash)
        throw new HttpError(409, 'Task key reused with different materials');
      return String(existing.id);
    }
    const id = randomUUID();
    sql
      .prepare(
        "INSERT INTO queue_tasks (id,client_id,task_key,input,input_hash,state,max_attempts,created_at,updated_at,next_attempt_at) VALUES (?,?,?,?,?,'queued',?,?,?,?)",
      )
      .run(
        id,
        clientId,
        input.taskKey,
        JSON.stringify(input),
        hash,
        input.maxAttempts,
        now,
        now,
        now,
      );
    this.database.event(id, 'queued', now, null, 'enqueued');
    return id;
  }

  control(clientId: string, running: boolean): void {
    if (running && this.blocked())
      throw new HttpError(409, 'Resolve uncertain outcomes before starting');
    this.database.connection
      .prepare(
        'INSERT INTO queue_controls (client_id,running) VALUES (?,?) ON CONFLICT(client_id) DO UPDATE SET running=excluded.running',
      )
      .run(clientId, Number(running));
  }

  blocked(): boolean {
    return Boolean(
      this.database.connection
        .prepare("SELECT 1 FROM queue_tasks WHERE state='uncertain' LIMIT 1")
        .get(),
    );
  }

  snapshot(clientId: string): QueueSnapshot {
    const sql = this.database.connection;
    const rows = sql
      .prepare(
        "SELECT id FROM queue_tasks WHERE client_id=? ORDER BY CASE WHEN state='uncertain' THEN 0 WHEN state IN ('dispatching','submitted','generating','download_pending') THEN 1 WHEN state='queued' THEN 2 ELSE 3 END,CASE WHEN state IN ('completed','failed','cancelled') THEN -sequence ELSE sequence END LIMIT 50",
      )
      .all(clientId);
    const counts = Object.fromEntries(
      taskStateSchema.options.map((state) => [state, 0]),
    );
    for (const row of sql
      .prepare(
        'SELECT state,COUNT(*) AS count FROM queue_tasks WHERE client_id=? GROUP BY state',
      )
      .all(clientId))
      counts[String(row.state)] = Number(row.count);
    return queueSnapshotSchema.parse({
      running:
        sql
          .prepare('SELECT running FROM queue_controls WHERE client_id=?')
          .get(clientId)?.running === 1,
      blockedByReview: this.blocked(),
      tasks: rows.map(
        (row) => this.database.task(String(row.id), clientId).summary,
      ),
      counts,
    });
  }

  active(): TaskRecord | undefined {
    const row = this.database.connection
      .prepare(
        "SELECT id FROM queue_tasks WHERE state IN ('dispatching','submitted','generating','download_pending') LIMIT 1",
      )
      .get();
    return row ? this.database.task(String(row.id)) : undefined;
  }

  candidate(
    clientIds: string[],
    flowClientIds: string[] = [],
  ): TaskRecord | undefined {
    if (!clientIds.length || this.blocked()) return undefined;
    const row = this.database.connection
      .prepare(
        `SELECT q.id FROM queue_tasks q JOIN queue_controls c ON c.client_id=q.client_id JOIN clients a ON a.id=q.client_id WHERE q.state='queued' AND c.running=1 AND a.authorized_at IS NOT NULL AND a.revoked_at IS NULL AND q.client_id IN (${clientIds.map(() => '?').join(',')}) AND (json_extract(q.input,'$.executor')='simulation'${flowClientIds.length ? ` OR q.client_id IN (${flowClientIds.map(() => '?').join(',')})` : ''}) ORDER BY q.sequence LIMIT 1`,
      )
      .get(...clientIds, ...flowClientIds);
    return row ? this.database.task(String(row.id)) : undefined;
  }

  claim(
    id: string,
    connectionId: string,
    now = Date.now(),
  ): TaskRecord | undefined {
    return this.database.transaction(() => {
      if (this.active() || this.blocked()) return undefined;
      const record = this.database.task(id);
      if (
        record.summary.state !== 'queued' ||
        record.summary.nextAttemptAt > now ||
        record.summary.attemptCount >= record.summary.maxAttempts
      )
        return undefined;
      const allowed = this.database.connection
        .prepare(
          'SELECT q.running FROM queue_controls q JOIN clients c ON c.id=q.client_id WHERE q.client_id=? AND c.authorized_at IS NOT NULL AND c.revoked_at IS NULL',
        )
        .get(record.clientId);
      if (allowed?.running !== 1) return undefined;
      const attemptId = randomUUID();
      const number = record.summary.attemptCount + 1;
      this.database.connection
        .prepare(
          "UPDATE queue_tasks SET state='dispatching',attempt_count=?,revision=revision+1,active_attempt_id=?,connection_id=?,deadline_at=?,updated_at=?,generation_id=NULL,result=NULL,last_error=NULL,safe_to_retry=0 WHERE id=?",
        )
        .run(number, attemptId, connectionId, now + 5000, now, id);
      this.database.connection
        .prepare(
          "INSERT INTO queue_attempts (id,task_id,number,connection_id,started_at,state) VALUES (?,?,?,?,?,'dispatching')",
        )
        .run(attemptId, id, number, connectionId, now);
      this.database.event(
        id,
        'dispatching',
        now,
        attemptId,
        'dispatch-intent-persisted',
      );
      return this.database.task(id);
    });
  }
}
