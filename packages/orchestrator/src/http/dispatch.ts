import type { FastifyInstance } from 'fastify';
import { dispatchUpdateSchema } from '@flow-batch/protocol';
import type { SignatureService } from '../security/signatures.js';
import type { ClientStore } from '../persistence/clients.js';
import type { DispatchStore } from '../persistence/dispatch.js';

export function registerDispatchRoutes(
  app: FastifyInstance,
  signatures: SignatureService,
  clients: ClientStore,
  store: DispatchStore,
): void {
  app.get('/api/dispatch', async (request) => {
    const client = await signatures.http(request);
    clients.authorized(client.id, client.extensionId);
    for (const record of store.list(client.id))
      if (
        record.state === 'pending' &&
        record.command.authorization.approvedAt < client.authorizedAt!
      )
        store.update(
          client.id,
          record.command.id,
          'blocked',
          'A autorização pertence a uma conexão anterior. Solicite uma nova autorização pelo chat.',
        );
    return { commands: store.list(client.id) };
  });
  app.post('/api/dispatch', async (request) => {
    const client = await signatures.http(request);
    clients.authorized(client.id, client.extensionId);
    const update = dispatchUpdateSchema.parse(request.body);
    store.update(client.id, update.id, update.state, update.message);
    return { commands: store.list(client.id) };
  });
}
