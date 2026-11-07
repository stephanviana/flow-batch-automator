import type { OrderRepository, ProductionOrder } from './repository.js';
import { HttpError } from '../security/errors.js';
import { QueueVisibility } from '../queue/visibility.js';
import { nextOrderNumber, restartEmptyOrderCycle } from './numbering.js';

export function canClearOrder(order: ProductionOrder): boolean {
  return (
    !order.archivedAt &&
    !order.lease &&
    [
      'awaiting-preparation',
      'prepared',
      'completed',
      'failed',
      'cancelled',
    ].includes(order.state) &&
    !order.dispatches.some((dispatch) =>
      ['pending', 'blocked'].includes(dispatch.state),
    ) &&
    !Object.entries(order.counts).some(
      ([state, count]) =>
        count > 0 && !['completed', 'failed', 'cancelled'].includes(state),
    )
  );
}

export interface OrderClearResult {
  cleared: number;
  nextNumber: number;
}

export class OrderVisibility {
  constructor(private readonly repository: OrderRepository) {}

  clear(ids: string[]): OrderClearResult {
    return this.repository.transaction(() => {
      const cleared = [...new Set(ids)].filter((id) => this.archive(id)).length;
      if (cleared) restartEmptyOrderCycle(this.repository.database);
      return { cleared, nextNumber: nextOrderNumber(this.repository.database) };
    });
  }

  private archive(id: string): boolean {
    const order = this.repository.get(id);
    if (order.archivedAt) return false;
    if (!canClearOrder(order))
      throw new HttpError(
        409,
        'Um pedido mudou ou ainda precisa de atenção. Atualize a lista antes de limpar.',
      );
    const database = this.repository.database;
    database
      .prepare('UPDATE production_orders SET archived_at=? WHERE id=?')
      .run(Date.now(), id);
    new QueueVisibility(database).clearOrder(id);
    return true;
  }
}
