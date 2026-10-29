import type { FastifyInstance } from 'fastify';
import {
  challengeRequestSchema,
  pairingRequestSchema,
  simulationRequestSchema,
} from '@flow-batch/protocol';
import type { ClientStore } from '../persistence/clients.js';
import type { SimulationStore } from '../persistence/simulations.js';
import type { ConnectionHub } from '../communication/sockets.js';
import {
  extensionIdentity,
  type SignatureService,
} from '../security/signatures.js';

export function registerConnectionRoutes(
  app: FastifyInstance,
  clients: ClientStore,
  signatures: SignatureService,
  simulations: SimulationStore,
  hub: ConnectionHub,
): void {
  app.post('/api/pairing', async (request) => {
    const extensionId = extensionIdentity(request);
    const { publicKey } = pairingRequestSchema.parse(request.body);
    return clients.request(extensionId, publicKey);
  });
  app.post('/api/challenges', async (request) => {
    const input = challengeRequestSchema.parse(request.body);
    return signatures.issue(
      input,
      extensionIdentity(request),
      request.headers.host ?? '',
    );
  });
  app.get('/api/identity', async (request) => {
    const client = await signatures.http(request);
    return {
      clientId: client.id,
      authorized: true,
      connected: hub.connected(client.id),
    };
  });
  app.get('/api/simulations', async (request) => {
    const client = await signatures.http(request);
    return { simulations: simulations.list(client.id) };
  });
  app.post('/api/simulations', async (request) => {
    const client = await signatures.http(request);
    const simulation = simulationRequestSchema.parse(request.body);
    return hub.simulate(client.id, simulation.requestId, simulation.durationMs);
  });
}
