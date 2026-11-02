import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { QUEUE_BODY_LIMIT } from '@flow-batch/protocol';
import type { AppConfig } from './config.js';
import { openDatabase } from './persistence/database.js';
import { registerHealth } from './http/health.js';
import { registerLocalBoundary } from './http/security.js';
import { ClientStore } from './persistence/clients.js';
import { SimulationStore } from './persistence/simulations.js';
import { SignatureService } from './security/signatures.js';
import { registerJsonHandling } from './http/json.js';
import { ConnectionHub } from './communication/sockets.js';
import { registerManagement } from './http/management.js';
import { registerConnectionRoutes } from './http/connection.js';
import { registerQueueRoutes } from './http/queue.js';
import { QueueDatabase } from './queue/database.js';
import { QueueRepository } from './queue/repository.js';
import { QueueMutations } from './queue/mutations.js';
import { QueueEngine } from './queue/engine.js';
import { BatchStore } from './persistence/batches.js';
import { registerBatchRoutes } from './http/batches.js';
import { DispatchStore } from './persistence/dispatch.js';
import { registerDispatchRoutes } from './http/dispatch.js';
import { LocalSessions } from './security/local-session.js';
import { OrderRepository } from './orders/repository.js';
import { MaterialFiles } from './orders/material-files.js';
import { registerOrders } from './http/orders.js';
import { registerMaterialDownloads } from './http/materials.js';

export function createApp(config: AppConfig): FastifyInstance {
  const database = openDatabase(config.databasePath, config.busyTimeoutMs);
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.cookie', 'req.headers.authorization'],
    },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: QUEUE_BODY_LIMIT,
    requestTimeout: 10000,
    connectionTimeout: 10000,
    forceCloseConnections: true,
    trustProxy: false,
  });
  const clients = new ClientStore(database);
  const simulations = new SimulationStore(database);
  simulations.interrupt(undefined, 'server-restart');
  const signatures = new SignatureService(database, clients);
  const sessions = new LocalSessions();
  const orders = new OrderRepository(database);
  const materials = new MaterialFiles(
    config.materialsDirectory,
    orders.materials,
  );
  const batches = new BatchStore(database);
  batches.interrupt();
  const hub = new ConnectionHub(clients, signatures, simulations);
  const queueDatabase = new QueueDatabase(database);
  const queueRepository = new QueueRepository(queueDatabase);
  const queueMutations = new QueueMutations(queueDatabase);
  queueMutations.interrupt(undefined, 'server-restart');
  const queueEngine = new QueueEngine(queueRepository, queueMutations, hub);
  hub.attachQueue(queueEngine);
  app.addHook('preClose', async (): Promise<void> => {
    queueEngine.stop();
  });
  registerJsonHandling(app);
  app.addHook('onClose', async (): Promise<void> => {
    database.close();
  });
  registerLocalBoundary(app, config.port);
  registerHealth(app, database);
  hub.register(app, config.port);
  const publicAssets = new URL('./public/', import.meta.url);
  registerManagement(app, clients, hub, publicAssets, sessions);
  registerOrders(app, sessions, orders, materials, clients, publicAssets);
  registerMaterialDownloads(app, signatures, clients, orders, materials);
  registerConnectionRoutes(app, clients, signatures, simulations, hub);
  registerBatchRoutes(app, signatures, clients, batches);
  registerDispatchRoutes(app, signatures, clients, new DispatchStore(database));
  registerQueueRoutes(
    app,
    signatures,
    clients,
    queueRepository,
    queueMutations,
    queueEngine,
  );
  return app;
}
