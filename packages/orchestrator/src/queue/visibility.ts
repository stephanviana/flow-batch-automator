import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

export const VISIBLE_QUEUE_TASK = `NOT EXISTS (SELECT 1 FROM queue_visibility v WHERE v.task_id=q.id AND v.revision>=q.revision AND q.state IN ('completed','failed','cancelled'))`;

export class QueueVisibility {
  constructor(private readonly database: DatabaseSync) {}

  clear(clientId: string): number {
    return this.clearWhere('q.client_id=?', [clientId]);
  }

  clearOrder(orderId: string): number {
    return this.clearWhere(
      'EXISTS (SELECT 1 FROM order_dispatches d WHERE d.batch_id=q.batch_id AND d.order_id=?)',
      [orderId],
    );
  }

  private clearWhere(filter: string, parameters: SQLInputValue[]): number {
    return Number(
      this.database
        .prepare(
          `INSERT INTO queue_visibility(task_id,revision,cleared_at) SELECT q.id,q.revision,? FROM queue_tasks q WHERE ${filter} AND q.state IN ('completed','failed','cancelled') AND ${VISIBLE_QUEUE_TASK} ON CONFLICT(task_id) DO UPDATE SET revision=excluded.revision,cleared_at=excluded.cleared_at`,
        )
        .run(Date.now(), ...parameters).changes,
    );
  }
}
