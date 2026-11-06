export function canClearOrder(order) {
  if (
    order.lease ||
    ['preparing', 'dispatched', 'blocked', 'uncertain'].includes(order.state)
  )
    return false;
  if (
    Object.entries(order.counts).some(
      ([state, count]) =>
        count > 0 && !['completed', 'failed', 'cancelled'].includes(state),
    )
  )
    return false;
  if (
    order.dispatches.some((dispatch) =>
      ['pending', 'blocked'].includes(dispatch.state),
    )
  )
    return false;
  return [
    'awaiting-preparation',
    'prepared',
    'completed',
    'failed',
    'cancelled',
  ].includes(order.state);
}

export class OrderListCleanup {
  cleared = new Map();

  visible(order) {
    return (
      !canClearOrder(order) ||
      this.cleared.get(order.id) !== this.version(order)
    );
  }

  clear(orders) {
    let count = 0;
    for (const order of orders) {
      if (!canClearOrder(order) || !this.visible(order)) continue;
      this.cleared.set(order.id, this.version(order));
      count++;
    }
    return count;
  }

  version(order) {
    return JSON.stringify([
      order.state,
      order.preparationHash,
      order.counts,
      order.dispatches,
    ]);
  }
}
