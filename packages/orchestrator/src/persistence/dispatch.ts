import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {
  dispatchCommandSchema,
  dispatchRecordSchema,
  type DispatchCommand,
  type DispatchRecord,
  type DispatchFailure,
} from '@flow-batch/protocol';
import { HttpError } from '../security/errors.js';

export class DispatchStore {
  constructor(private readonly database: DatabaseSync) {}

  register(clientId: string, input: DispatchCommand): void {
    const command = dispatchCommandSchema.parse(input);
    if (command.clientId !== clientId)
      throw new HttpError(403, 'Dispatch owner mismatch');
    const body = JSON.stringify(command);
    const hash = createHash('sha256').update(body).digest('hex');
    const existing = this.database
      .prepare('SELECT body_hash FROM dispatch_commands WHERE id=?')
      .get(command.id);
    if (existing) {
      if (existing.body_hash !== hash)
        throw new HttpError(409, 'Dispatch materials changed');
      return;
    }
    const materials = (entry: DispatchCommand): string =>
      JSON.stringify([entry.name, entry.manifest, entry.references]);
    const prior = this.database
      .prepare(
        "SELECT body FROM dispatch_commands WHERE client_id=? AND json_extract(body,'$.manifest.id')=? LIMIT 1",
      )
      .get(clientId, command.manifest.id);
    if (
      prior &&
      materials(
        dispatchCommandSchema.parse(JSON.parse(String(prior.body)) as unknown),
      ) !== materials(command)
    )
      throw new HttpError(
        409,
        'Manifest identity reused with changed materials',
      );
    const now = Date.now();
    const expired =
      command.authorization.expiresAt <= now ||
      command.authorization.approvedAt > now + 30_000;
    this.database
      .prepare(
        'INSERT INTO dispatch_commands (id,client_id,body,body_hash,state,message,created_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(
        command.id,
        clientId,
        body,
        hash,
        expired ? 'blocked' : 'pending',
        expired
          ? 'Autorização expirada ou com horário incompatível. Nenhuma nova geração foi autorizada.'
          : '',
        command.authorization.approvedAt,
      );
  }

  list(clientId: string): DispatchRecord[] {
    return this.database
      .prepare(
        "SELECT body,state,message FROM dispatch_commands WHERE client_id=? ORDER BY CASE state WHEN 'pending' THEN 0 WHEN 'blocked' THEN 1 ELSE 2 END,created_at,rowid LIMIT 100",
      )
      .all(clientId)
      .map((row) =>
        dispatchRecordSchema.parse({
          command: JSON.parse(String(row.body)) as unknown,
          state: row.state,
          message: row.message,
        }),
      );
  }

  update(
    clientId: string,
    id: string,
    state: 'pending' | 'queued' | 'blocked',
    message: string,
    failure?: DispatchFailure,
  ): void {
    const result = this.database
      .prepare(
        "UPDATE dispatch_commands SET state=?,message=?,failure=? WHERE id=? AND client_id=? AND state='pending'",
      )
      .run(
        state,
        message,
        failure ? JSON.stringify(failure) : null,
        id,
        clientId,
      );
    if (
      !result.changes &&
      this.database
        .prepare(
          'SELECT state FROM dispatch_commands WHERE id=? AND client_id=?',
        )
        .get(id, clientId)?.state !== state
    )
      throw new HttpError(409, 'Dispatch is absent or already resolved');
  }
}
