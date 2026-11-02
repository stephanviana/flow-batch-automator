import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { materialSchema, type Material } from '@flow-batch/protocol';
import { HttpError } from '../security/errors.js';

export class MaterialStore {
  constructor(readonly database: DatabaseSync) {}

  get(id: string): Material {
    const row = this.database
      .prepare('SELECT * FROM materials WHERE id=?')
      .get(id);
    if (!row) throw new HttpError(404, 'Material não encontrado.');
    return materialSchema.parse({
      available: row.state === 'available',
      id: row.id,
      name: row.name,
      mime: row.mime,
      size: row.size,
      sha256: row.sha256,
    });
  }

  byHash(hash: string): Material | null {
    const row = this.database
      .prepare('SELECT id,state FROM materials WHERE sha256=?')
      .get(hash);
    if (!row) return null;
    if (row.state === 'deleting')
      throw new HttpError(
        409,
        'Material em limpeza. Tente importar novamente após a conclusão.',
      );
    return this.get(String(row.id));
  }

  preserve(input: Omit<Material, 'id' | 'available'>): Material {
    const existing = this.byHash(input.sha256);
    if (existing) {
      this.database
        .prepare(
          "UPDATE materials SET state='available',created_at=? WHERE id=?",
        )
        .run(Date.now(), existing.id);
      return this.get(existing.id);
    }
    const id = randomUUID();
    this.database
      .prepare(
        "INSERT INTO materials (id,name,mime,size,sha256,created_at,state) VALUES (?,?,?,?,?,?,'available')",
      )
      .run(id, input.name, input.mime, input.size, input.sha256, Date.now());
    return this.get(id);
  }

  candidates(): Material[] {
    const rows = this.database
      .prepare(
        `SELECT m.id FROM materials m WHERE m.state IN ('available','deleting')
      AND (m.created_at < ? OR EXISTS (SELECT 1 FROM order_materials om WHERE om.material_id=m.id))
      AND NOT EXISTS (SELECT 1 FROM order_materials om JOIN production_orders o ON o.id=om.order_id
       WHERE om.material_id=m.id AND o.state!='cancelled' AND NOT (
        o.state='dispatched' AND EXISTS (SELECT 1 FROM order_dispatches d WHERE d.order_id=o.id)
        AND NOT EXISTS (SELECT 1 FROM order_dispatches d JOIN dispatch_commands c ON c.id=d.dispatch_id
          WHERE d.order_id=o.id AND c.state!='queued')
        AND NOT EXISTS (SELECT 1 FROM order_dispatches d WHERE d.order_id=o.id AND NOT EXISTS
          (SELECT 1 FROM queue_tasks q WHERE q.batch_id=d.batch_id))
        AND NOT EXISTS (SELECT 1 FROM order_dispatches d JOIN queue_tasks q ON q.batch_id=d.batch_id
          WHERE d.order_id=o.id AND q.state!='completed')
        AND NOT EXISTS (SELECT 1 FROM order_dispatches d JOIN dispatch_commands c ON c.id=d.dispatch_id
          WHERE d.order_id=o.id AND (SELECT COUNT(*) FROM queue_tasks q WHERE q.batch_id=d.batch_id)
            != json_array_length(c.body,'$.manifest.tasks'))
       )) ORDER BY m.created_at,m.id`,
      )
      .all(Date.now() - 86_400_000);
    return rows.map((row) => this.get(String(row.id)));
  }
}
