import type { DatabaseSync } from 'node:sqlite';
import { importImageCount, usesSingleImage } from '@flow-batch/protocol';
import { HttpError } from '../security/errors.js';
import type { ProductionOrder } from './repository.js';

const duration = 86_400_000;
const closedStates = ['cancelled', 'completed', 'failed'];

export function autoRetrySummary(
  sql: DatabaseSync,
  order: ProductionOrder,
  now = Date.now(),
): {
  available: boolean;
  expiresAt: number | null;
  images: number;
  videos: number;
} {
  const policy = sql
    .prepare(
      'SELECT expires_at FROM order_auto_retry_authorizations WHERE order_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY expires_at DESC LIMIT 1',
    )
    .get(order.id, now);
  return {
    available: order.archivedAt === null && !closedStates.includes(order.state),
    expiresAt:
      typeof policy?.expires_at === 'number' ? policy.expires_at : null,
    images: order.preparation
      ? order.preparation.manifests.reduce(
          (sum, manifest) => sum + importImageCount(manifest),
          0,
        )
      : order.products.reduce(
          (sum, product) =>
            sum +
            product.groups.reduce(
              (count, group) =>
                count +
                group.count *
                  (group.format === 'clone'
                    ? 3
                    : usesSingleImage(group.format)
                      ? 1
                      : 2),
              0,
            ),
          0,
        ),
    videos: order.products.reduce(
      (sum, product) =>
        sum +
        product.groups.reduce((count, group) => count + group.count * 3, 0),
      0,
    ),
  };
}

export function updateAutoRetry(
  sql: DatabaseSync,
  order: ProductionOrder,
  requestId: string,
  enabled: boolean,
  now = Date.now(),
): void {
  if (
    order.archivedAt !== null ||
    (enabled && closedStates.includes(order.state))
  )
    throw new HttpError(409, 'Este pedido está encerrado ou foi removido.');
  const previous = sql
    .prepare('SELECT order_id FROM order_auto_retry_authorizations WHERE id=?')
    .get(requestId);
  if (previous) {
    if (previous.order_id !== order.id || !enabled)
      throw new HttpError(
        409,
        'Esta autorização já pertence a outro pedido ou ação.',
      );
    return;
  }
  sql
    .prepare(
      'UPDATE order_auto_retry_authorizations SET revoked_at=? WHERE order_id=? AND revoked_at IS NULL',
    )
    .run(now, order.id);
  if (enabled) {
    sql
      .prepare(
        'INSERT INTO order_auto_retry_authorizations (id,order_id,authorized_at,expires_at) VALUES (?,?,?,?)',
      )
      .run(requestId, order.id, now, now + duration);
  }
}
