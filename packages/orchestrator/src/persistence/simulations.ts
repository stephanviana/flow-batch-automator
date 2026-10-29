import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { simulationSchema, type Simulation } from '@flow-batch/protocol';

export class SimulationStore {
  constructor(private readonly database: DatabaseSync) {}

  find(clientId: string, requestId: string): Simulation | undefined {
    const row = this.database
      .prepare(
        'SELECT id FROM simulations WHERE client_id = ? AND request_id = ?',
      )
      .get(clientId, requestId);
    return row ? this.get(String(row.id)) : undefined;
  }

  get(id: string): Simulation {
    const row = this.database
      .prepare(
        'SELECT id,request_id AS requestId,state,duration_ms AS durationMs,created_at AS createdAt,updated_at AS updatedAt FROM simulations WHERE id = ?',
      )
      .get(id);
    const events = this.database
      .prepare(
        'SELECT state,at,reason FROM simulation_events WHERE simulation_id = ? ORDER BY id',
      )
      .all(id);
    return simulationSchema.parse({ ...row, events });
  }

  list(clientId: string): Simulation[] {
    return this.database
      .prepare(
        'SELECT id FROM simulations WHERE client_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 20',
      )
      .all(clientId)
      .map((row) => this.get(String(row.id)));
  }

  create(
    clientId: string,
    connectionId: string,
    requestId: string,
    durationMs: number,
  ): Simulation {
    const id = randomUUID();
    const now = Date.now();
    this.transaction((): void => {
      this.database
        .prepare(
          "INSERT INTO simulations (id,client_id,connection_id,request_id,duration_ms,state,created_at,updated_at) VALUES (?,?,?,?,?,'sent',?,?)",
        )
        .run(id, clientId, connectionId, requestId, durationMs, now, now);
      this.event(id, 'sent', now, 'simulation-only');
    });
    return this.get(id);
  }

  transition(
    id: string,
    connectionId: string,
    state: 'running' | 'completed',
  ): void {
    this.transaction((): void => {
      const now = Date.now();
      const previous = state === 'running' ? 'sent' : 'running';
      const row = this.database
        .prepare(
          'UPDATE simulations SET state = ?,updated_at = ? WHERE id = ? AND connection_id = ? AND state = ? RETURNING id',
        )
        .get(state, now, id, connectionId, previous);
      if (row) this.event(id, state, now, 'simulation-only');
    });
  }

  interrupt(connectionId?: string, reason = 'connection-lost'): void {
    this.transaction((): void => {
      const now = Date.now();
      const clause = connectionId ? ' AND connection_id = ?' : '';
      const rows = this.database
        .prepare(
          `UPDATE simulations SET state = 'interrupted',updated_at = ? WHERE state IN ('sent','running')${clause} RETURNING id`,
        )
        .all(...(connectionId ? [now, connectionId] : [now]));
      for (const row of rows)
        this.event(String(row.id), 'interrupted', now, reason);
    });
  }

  private event(
    id: string,
    state: Simulation['state'],
    at: number,
    reason: string,
  ): void {
    this.database
      .prepare(
        'INSERT INTO simulation_events (simulation_id,state,at,reason) VALUES (?,?,?,?)',
      )
      .run(id, state, at, reason);
  }

  private transaction(operation: () => void): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      operation();
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
