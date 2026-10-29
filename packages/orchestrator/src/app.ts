import Fastify, { LogController, type FastifyInstance } from 'fastify';
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

export function createApp(config: AppConfig): FastifyInstance {
  const database = openDatabase(config.databasePath, config.busyTimeoutMs);
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.cookie', 'req.headers.authorization'],
    },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 16384,
    requestTimeout: 10000,
    connectionTimeout: 10000,
    forceCloseConnections: true,
    trustProxy: false,
  });
  const clients = new ClientStore(database);
  const simulations = new SimulationStore(database);
  simulations.interrupt(undefined, 'server-restart');
  const signatures = new SignatureService(database, clients);
  const hub = new ConnectionHub(clients, signatures, simulations);
  registerJsonHandling(app);
  app.addHook('onClose', async (): Promise<void> => {
    database.close();
  });
  registerLocalBoundary(app, config.port);
  registerHealth(app, database);
  hub.register(app, config.port);
  registerManagement(app, clients, hub, new URL('./public/', import.meta.url));
  registerConnectionRoutes(app, clients, signatures, simulations, hub);
  return app;
}
