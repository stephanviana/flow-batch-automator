import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { orderPublicationSchema } from '@flow-batch/protocol';
import type { LocalSessions } from '../security/local-session.js';
import type { ClientStore } from '../persistence/clients.js';
import type { OrderRepository } from '../orders/repository.js';
import type { MaterialFiles } from '../orders/material-files.js';
import { prepareOrder, variationPlan } from '../orders/preparation.js';
import { dispatchOrder } from '../orders/dispatch.js';
import { HttpError } from '../security/errors.js';

export function registerOrders(
  app: FastifyInstance,
  sessions: LocalSessions,
  repository: OrderRepository,
  files: MaterialFiles,
  clients: ClientStore,
  assets: URL,
): void {
  const templates = readFileSync(new URL('animacao.md', assets), 'utf8');
  app.addContentTypeParser(
    'application/octet-stream',
    (_request, payload, done): void => done(null, payload),
  );
  const id = (params: unknown): string =>
    z.object({ id: z.uuid() }).parse(params).id;
  app.get('/manage/orders', async (request) => {
    sessions.require(request);
    return { orders: repository.list() };
  });
  app.post('/manage/orders', { bodyLimit: 262144 }, async (request) => {
    sessions.require(request);
    return repository.create(request.body);
  });
  app.get('/manage/orders/:number', async (request) => {
    sessions.require(request);
    const number = z.coerce
      .number()
      .int()
      .positive()
      .parse((request.params as { number: string }).number);
    const order = repository.get(number);
    return { order, variationPlan: await variationPlan(order) };
  });
  app.post('/manage/orders/:id/claim', async (request) => {
    sessions.require(request);
    const { worker, revise } = z
      .strictObject({
        worker: z.string().trim().min(1).max(80),
        revise: z.boolean().default(false),
      })
      .parse(request.body);
    return repository.claim(id(request.params), worker, revise);
  });
  app.post('/manage/orders/:id/heartbeat', async (request) => {
    sessions.require(request);
    const { leaseId } = z
      .strictObject({ leaseId: z.uuid() })
      .parse(request.body);
    return repository.heartbeat(id(request.params), leaseId);
  });
  app.post(
    '/manage/orders/:id/prepare',
    { bodyLimit: 8_388_608 },
    async (request) => {
      sessions.require(request);
      const input = orderPublicationSchema.parse(request.body),
        key = id(request.params);
      const order = repository.get(key);
      if (order.state !== 'prepared')
        repository.requireLease(key, input.leaseId);
      const prepared = await prepareOrder(order, input, templates);
      return repository.publish(key, input.leaseId, prepared);
    },
  );
  app.post('/manage/orders/:id/approve', async (request) => {
    sessions.require(request);
    const input = z
      .strictObject({
        approve: z.literal(true),
        preparationHash: z.string().regex(/^[a-f0-9]{64}$/),
        clientId: z.uuid(),
      })
      .parse(request.body);
    const client = clients.get(input.clientId);
    if (!client) throw new HttpError(404, 'Extensão não encontrada.');
    clients.authorized(client.id, client.extensionId);
    return dispatchOrder(
      repository,
      id(request.params),
      input.preparationHash,
      client.id,
    );
  });
  app.post('/manage/orders/:id/cancel', async (request) => {
    sessions.require(request);
    return repository.cancel(id(request.params));
  });
  app.post('/manage/materials', { bodyLimit: 8_388_608 }, async (request) => {
    sessions.require(request);
    const encoded = z
      .string()
      .max(1000)
      .parse(request.headers['x-flow-filename']);
    let name: string;
    try {
      name = decodeURIComponent(encoded);
    } catch {
      throw new HttpError(400, 'Nome de arquivo inválido.');
    }
    name = z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine((value) =>
        [...value].every(
          (character) =>
            character.charCodeAt(0) >= 32 && !'/\\'.includes(character),
        ),
      )
      .parse(name);
    if (!(request.body instanceof Readable))
      throw new HttpError(
        415,
        'Envie o arquivo como application/octet-stream.',
      );
    return files.import(request.body, name);
  });
  app.get('/manage/materials/:id', async (request, reply) => {
    sessions.require(request);
    const { material, stream } = await files.read(id(request.params));
    reply
      .type(material.mime)
      .header('Content-Disposition', `attachment; filename="${material.id}"`);
    return stream;
  });
  app.get('/manage/cleanup', async (request) => {
    sessions.require(request);
    const materials = repository.materials.candidates();
    return {
      materials,
      bytes: materials.reduce((sum, material) => sum + material.size, 0),
    };
  });
  app.post('/manage/cleanup', async (request) => {
    sessions.require(request);
    const { ids } = z
      .strictObject({ ids: z.array(z.uuid()).max(1000) })
      .parse(request.body);
    return files.cleanup(ids);
  });
}
