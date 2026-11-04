import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  orderDraftSchema,
  importImageCount,
  type OrderDraft,
  type OrderPublication,
  type OrderState,
  type Material,
  type ImportManifest,
} from '@flow-batch/protocol';
import { MaterialStore } from './material-store.js';
import { HttpError } from '../security/errors.js';

export interface PreparedOrder {
  library?: { libraryId: string; revision: string };
  products: OrderPublication['products'];
  manifests: ImportManifest[];
}
export interface ProductionOrder extends OrderDraft {
  number: number;
  state: OrderState;
  createdAt: number;
  materials: Material[];
  lease: { worker: string; expiresAt: number } | null;
  preparation: PreparedOrder | null;
  preparationHash: string | null;
  dispatches: { id: string; state: string; message: string }[];
  counts: Record<string, number>;
}
export function contentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class OrderRepository {
  readonly materials: MaterialStore;
  constructor(readonly database: DatabaseSync) {
    this.materials = new MaterialStore(database);
  }

  transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  create(raw: unknown): ProductionOrder {
    const draft = orderDraftSchema.parse(raw);
    const hash = contentHash(draft);
    return this.transaction(() => {
      const previous = this.database
        .prepare('SELECT body_hash FROM production_orders WHERE id=?')
        .get(draft.id);
      if (previous) {
        if (previous.body_hash !== hash)
          throw new HttpError(
            409,
            'Este pedido já foi salvo com outras configurações.',
          );
        return this.get(draft.id);
      }
      for (const product of draft.products) {
        for (const id of product.materials) {
          if (!this.materials.get(id).available)
            throw new HttpError(
              409,
              'Um material foi removido. Importe-o novamente.',
            );
        }
        if (!this.materials.get(product.referenceId).mime.startsWith('image/'))
          throw new HttpError(
            400,
            'Escolha uma imagem como referência de geração.',
          );
        for (const group of product.groups)
          if (
            group.videoReferenceId &&
            this.materials.get(group.videoReferenceId).mime !== 'video/mp4'
          )
            throw new HttpError(
              400,
              'Escolha um vídeo MP4 como referência da clonagem.',
            );
      }
      this.database
        .prepare(
          "INSERT INTO production_orders (id,body,body_hash,state,created_at) VALUES (?,?,?,'awaiting-preparation',?)",
        )
        .run(draft.id, JSON.stringify(draft), hash, Date.now());
      const insert = this.database.prepare(
        'INSERT OR IGNORE INTO order_materials (order_id,material_id) VALUES (?,?)',
      );
      for (const product of draft.products)
        for (const id of product.materials) insert.run(draft.id, id);
      return this.get(draft.id);
    });
  }

  get(identity: string | number): ProductionOrder {
    const row =
      typeof identity === 'number'
        ? this.database
            .prepare('SELECT * FROM production_orders WHERE number=?')
            .get(identity)
        : this.database
            .prepare('SELECT * FROM production_orders WHERE id=?')
            .get(identity);
    if (!row) throw new HttpError(404, 'Pedido não encontrado.');
    const draft = orderDraftSchema.parse(JSON.parse(String(row.body)));
    const dispatches = this.database
      .prepare(
        'SELECT c.id,c.state,c.message FROM order_dispatches d JOIN dispatch_commands c ON c.id=d.dispatch_id WHERE d.order_id=? ORDER BY c.rowid',
      )
      .all(draft.id)
      .map((entry) => ({
        id: String(entry.id),
        state: String(entry.state),
        message: String(entry.message),
      }));
    const counts: Record<string, number> = {};
    for (const entry of this.database
      .prepare(
        'SELECT q.state,COUNT(*) AS count FROM queue_tasks q JOIN order_dispatches d ON d.batch_id=q.batch_id WHERE d.order_id=? GROUP BY q.state',
      )
      .all(draft.id))
      counts[String(entry.state)] = Number(entry.count);
    const preparation =
      row.preparation === null
        ? null
        : (JSON.parse(String(row.preparation)) as PreparedOrder);
    let state = row.state as OrderState;
    if (state === 'preparing' && Number(row.lease_expires_at) <= Date.now())
      state = 'awaiting-preparation';
    if (state === 'dispatched') {
      const total = preparation?.manifests.reduce(
        (sum, manifest) => sum + manifest.tasks.length,
        0,
      );
      if (counts.uncertain) state = 'uncertain';
      else if (dispatches.some((dispatch) => dispatch.state === 'blocked'))
        state = 'blocked';
      else if (total && counts.completed === total) state = 'completed';
      else if (
        total &&
        (counts.completed ?? 0) +
          (counts.failed ?? 0) +
          (counts.cancelled ?? 0) ===
          total
      )
        state = 'failed';
    }
    return {
      ...draft,
      number: Number(row.number),
      state,
      createdAt: Number(row.created_at),
      preparation,
      preparationHash:
        row.preparation_hash === null ? null : String(row.preparation_hash),
      counts,
      dispatches,
      materials: [
        ...new Set(draft.products.flatMap((product) => product.materials)),
      ].map((id) => this.materials.get(id)),
      lease:
        state === 'preparing'
          ? {
              worker: String(row.lease_worker),
              expiresAt: Number(row.lease_expires_at),
            }
          : null,
    };
  }

  list(): (Omit<ProductionOrder, 'preparation'> & {
    generationCounts: { images: number; videos: number };
  })[] {
    return this.database
      .prepare(
        "SELECT id FROM production_orders ORDER BY CASE state WHEN 'awaiting-preparation' THEN 0 WHEN 'preparing' THEN 0 WHEN 'prepared' THEN 1 WHEN 'dispatched' THEN 2 ELSE 3 END,number DESC LIMIT 200",
      )
      .all()
      .map((row) => {
        const { preparation, ...summary } = this.get(String(row.id));
        const videos =
          preparation?.manifests.reduce(
            (sum, manifest) => sum + manifest.tasks.length,
            0,
          ) ?? 0;
        return {
          ...summary,
          generationCounts: {
            images:
              preparation?.manifests.reduce(
                (sum, manifest) => sum + importImageCount(manifest),
                0,
              ) ?? 0,
            videos,
          },
        };
      });
  }

  claim(
    id: string,
    worker: string,
    revise = false,
  ): { leaseId: string; order: ProductionOrder } {
    return this.transaction(() => {
      const order = this.get(id);
      if (
        order.state !== 'awaiting-preparation' &&
        !(revise && order.state === 'prepared')
      )
        throw new HttpError(
          409,
          'Pedido já preparado, reservado ou encerrado. Consulte o estado antes de continuar.',
        );
      if (order.materials.some((material) => !material.available))
        throw new HttpError(409, 'Pedido com materiais indisponíveis.');
      const leaseId = randomUUID();
      this.database
        .prepare(
          "UPDATE production_orders SET state='preparing',lease_id=?,lease_worker=?,lease_expires_at=? WHERE id=?",
        )
        .run(leaseId, worker, Date.now() + 1_800_000, id);
      return { leaseId, order: this.get(id) };
    });
  }

  requireLease(id: string, leaseId: string): ProductionOrder {
    const row = this.database
      .prepare('SELECT lease_id FROM production_orders WHERE id=?')
      .get(id);
    const order = this.get(id);
    if (order.state !== 'preparing' || row?.lease_id !== leaseId)
      throw new HttpError(
        409,
        'Reserva de preparação expirada ou pertencente a outro agente.',
      );
    return order;
  }

  heartbeat(id: string, leaseId: string): ProductionOrder {
    this.requireLease(id, leaseId);
    this.database
      .prepare('UPDATE production_orders SET lease_expires_at=? WHERE id=?')
      .run(Date.now() + 1_800_000, id);
    return this.get(id);
  }

  publish(
    id: string,
    leaseId: string,
    preparation: PreparedOrder,
  ): ProductionOrder {
    return this.transaction(() => {
      const hash = contentHash(preparation),
        order = this.get(id);
      if (order.preparationHash === hash && order.state !== 'preparing')
        return order;
      this.requireLease(id, leaseId);
      this.database
        .prepare(
          'INSERT OR IGNORE INTO order_preparations (order_id,hash,body,created_at) VALUES (?,?,?,?)',
        )
        .run(id, hash, JSON.stringify(preparation), Date.now());
      this.database
        .prepare(
          "UPDATE production_orders SET state='prepared',preparation=?,preparation_hash=?,lease_id=NULL,lease_worker=NULL,lease_expires_at=NULL WHERE id=?",
        )
        .run(JSON.stringify(preparation), hash, id);
      return this.get(id);
    });
  }

  cancel(id: string): ProductionOrder {
    const order = this.get(id);
    if (
      !['awaiting-preparation', 'prepared', 'cancelled'].includes(order.state)
    )
      throw new HttpError(
        409,
        'O pedido está reservado ou já foi despachado. Revise a execução antes de encerrar.',
      );
    this.database
      .prepare("UPDATE production_orders SET state='cancelled' WHERE id=?")
      .run(id);
    return this.get(id);
  }
}
