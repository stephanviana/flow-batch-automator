import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { dispatchCommandSchema } from '@flow-batch/protocol';
import type { SignatureService } from '../security/signatures.js';
import type { ClientStore } from '../persistence/clients.js';
import type { OrderRepository } from '../orders/repository.js';
import type { MaterialFiles } from '../orders/material-files.js';
import { referencePath } from '../orders/preparation.js';
import { HttpError } from '../security/errors.js';

export function registerMaterialDownloads(
  app: FastifyInstance,
  signatures: SignatureService,
  clients: ClientStore,
  orders: OrderRepository,
  files: MaterialFiles,
): void {
  app.get('/api/materials', async (request) => {
    const client = await signatures.http(request);
    clients.authorized(client.id, client.extensionId);
    const retained = orders.database
      .prepare(
        "SELECT input FROM queue_tasks WHERE client_id=? AND state IN ('queued','dispatching','submitted','generating','download_pending','uncertain')",
      )
      .all(client.id)
      .flatMap((row) => {
        const input = JSON.parse(String(row.input)) as {
          flow?: { reference: { assetId: string } };
        };
        return input.flow ? [input.flow.reference.assetId] : [];
      });
    return { retained: [...new Set(retained)] };
  });
  app.post('/api/materials', async (request) => {
    const client = await signatures.http(request);
    clients.authorized(client.id, client.extensionId);
    const input = z
      .strictObject({ dispatchId: z.uuid(), path: z.string().max(200) })
      .parse(request.body);
    const row = orders.database
      .prepare(
        'SELECT c.body,d.order_id FROM dispatch_commands c JOIN order_dispatches d ON d.dispatch_id=c.id WHERE c.id=? AND c.client_id=?',
      )
      .get(input.dispatchId, client.id);
    if (!row) throw new HttpError(404, 'Referência autorizada não encontrada.');
    const command = dispatchCommandSchema.parse(JSON.parse(String(row.body)));
    const approved = command.references.find(
      (reference) => reference.path === input.path,
    );
    if (
      !approved ||
      command.authorization.expiresAt <= Date.now() ||
      command.authorization.approvedAt < client.authorizedAt!
    )
      throw new HttpError(403, 'Autorização de material inválida ou expirada.');
    const order = orders.get(String(row.order_id));
    const material = order.materials.find(
      (entry) =>
        referencePath(entry) === input.path &&
        entry.sha256 === approved.sha256 &&
        entry.size === approved.size,
    );
    if (!material)
      throw new HttpError(409, 'Material diferente da referência aprovada.');
    const { bytes } = await files.verifiedBytes(material.id);
    return {
      name: input.path,
      mime: material.mime,
      base64: bytes.toString('base64'),
    };
  });
}
