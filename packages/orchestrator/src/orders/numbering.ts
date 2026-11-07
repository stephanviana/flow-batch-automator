import type { DatabaseSync } from 'node:sqlite';

export function currentOrderCycle(database: DatabaseSync): number {
  return Number(
    database
      .prepare(
        "SELECT value FROM application_metadata WHERE key='orders_cycle'",
      )
      .get()!.value,
  );
}

export function nextOrderNumber(database: DatabaseSync): number {
  return Number(
    database
      .prepare(
        'SELECT COALESCE(MAX(public_number),0)+1 AS next FROM production_orders WHERE number_cycle=?',
      )
      .get(currentOrderCycle(database))!.next,
  );
}

// Called inside the same transaction as archival, so concurrent creates cannot
// reuse a number while an order still belongs to the current list.
export function restartEmptyOrderCycle(database: DatabaseSync): void {
  const remaining = database
    .prepare(
      'SELECT 1 FROM production_orders WHERE number_cycle=? AND archived_at IS NULL LIMIT 1',
    )
    .get(currentOrderCycle(database));
  if (!remaining)
    database
      .prepare(
        "UPDATE application_metadata SET value=CAST(value AS INTEGER)+1 WHERE key='orders_cycle'",
      )
      .run();
}
