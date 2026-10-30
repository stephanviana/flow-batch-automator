import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  clientMessageSchema,
  extensionIdSchema,
  type ServerMessage,
  type Simulation,
  type QueueExecute,
} from '@flow-batch/protocol';
import type { QueueTransport, QueueEvents } from '../queue/ports.js';
import type { ClientStore } from '../persistence/clients.js';
import type { SimulationStore } from '../persistence/simulations.js';
import type { SignatureService } from '../security/signatures.js';
import { HttpError } from '../security/errors.js';

interface Session {
  id: string;
  socket: WebSocket;
  extensionId: string;
  authority: string;
  clientId?: string;
  verifying: boolean;
  lastSeen: number;
  queueCapable: boolean;
  flowCapable: boolean;
}

export class ConnectionHub implements QueueTransport {
  private queue: QueueEvents | undefined;
  private readonly sessions = new Map<string, Session>();
  private readonly server = new WebSocketServer({
    noServer: true,
    maxPayload: 65536,
    perMessageDeflate: false,
  });
  private watchdog?: ReturnType<typeof setInterval>;

  constructor(
    private readonly clients: ClientStore,
    private readonly signatures: SignatureService,
    private readonly simulations: SimulationStore,
  ) {}

  attachQueue(queue: QueueEvents): void {
    this.queue = queue;
  }
  queueConnections(): {
    clientId: string;
    connectionId: string;
    flowCapable: boolean;
  }[] {
    const connections: {
      clientId: string;
      connectionId: string;
      flowCapable: boolean;
    }[] = [];
    for (const session of this.sessions.values()) {
      if (
        !session.clientId ||
        !session.queueCapable ||
        session.socket.readyState !== WebSocket.OPEN
      )
        continue;
      try {
        this.clients.authorized(session.clientId, session.extensionId);
        connections.push({
          clientId: session.clientId,
          connectionId: session.id,
          flowCapable: session.flowCapable,
        });
      } catch {
        continue;
      }
    }
    return connections;
  }
  sendQueue(connectionId: string, message: QueueExecute): boolean {
    const session = this.sessions.get(connectionId);
    if (
      !session?.clientId ||
      !session.queueCapable ||
      session.socket.readyState !== WebSocket.OPEN
    )
      return false;
    this.clients.authorized(session.clientId, session.extensionId);
    this.send(session, message);
    return true;
  }
  closeQueue(connectionId: string): void {
    this.sessions
      .get(connectionId)
      ?.socket.close(4008, 'Queue attempt timeout');
  }

  register(app: FastifyInstance, port: number): void {
    app.server.on('upgrade', (request, socket, head): void => {
      const origin = request.headers.origin ?? '';
      const extensionId = origin.startsWith('chrome-extension://')
        ? origin.slice(19)
        : '';
      if (
        request.url !== '/ws' ||
        !extensionIdSchema.safeParse(extensionId).success ||
        ![`127.0.0.1:${port}`, `localhost:${port}`].includes(
          request.headers.host ?? '',
        ) ||
        this.sessions.size >= 16
      ) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      this.server.handleUpgrade(request, socket, head, (websocket): void => {
        this.accept(websocket, extensionId, request.headers.host ?? '');
      });
    });
    this.watchdog = setInterval((): void => {
      for (const session of this.sessions.values())
        if (Date.now() - session.lastSeen > 45000) session.socket.terminate();
    }, 20000).unref();
    app.addHook('preClose', async (): Promise<void> => {
      clearInterval(this.watchdog);
      for (const session of this.sessions.values()) {
        this.simulations.interrupt(session.id, 'server-shutdown');
        this.queue?.disconnected(session.id, 'server-shutdown');
        session.socket.terminate();
      }
      await new Promise<void>((resolve) => {
        this.server.close(() => resolve());
      });
    });
  }

  connected(clientId: string): boolean {
    return [...this.sessions.values()].some(
      (session) =>
        session.clientId === clientId &&
        session.socket.readyState === WebSocket.OPEN,
    );
  }

  simulate(
    clientId: string,
    requestId: string,
    durationMs: number,
  ): Simulation {
    const existing = this.simulations.find(clientId, requestId);
    if (existing) return existing;
    const session = [...this.sessions.values()].find(
      (entry) =>
        entry.clientId === clientId &&
        entry.socket.readyState === WebSocket.OPEN,
    );
    if (!session) throw new HttpError(409, 'Extension is not connected');
    const simulation = this.simulations.create(
      clientId,
      session.id,
      requestId,
      durationMs,
    );
    this.send(session, { type: 'simulate', id: simulation.id, durationMs });
    return simulation;
  }

  revoke(clientId: string): void {
    for (const session of this.sessions.values()) {
      if (session.clientId !== clientId) continue;
      this.simulations.interrupt(session.id, 'authorization-revoked');
      this.queue?.disconnected(session.id, 'authorization-revoked');
      this.send(session, { type: 'revoked' });
      session.socket.close(4003, 'Revoked');
    }
  }

  private accept(
    socket: WebSocket,
    extensionId: string,
    authority: string,
  ): void {
    const session: Session = {
      id: randomUUID(),
      socket,
      extensionId,
      authority,
      verifying: false,
      lastSeen: Date.now(),
      queueCapable: false,
      flowCapable: false,
    };
    this.sessions.set(session.id, session);
    const deadline = setTimeout((): void => {
      if (!session.clientId) socket.close(4008, 'Authentication timeout');
    }, 5000).unref();
    socket.on('message', (data: RawData, isBinary: boolean): void => {
      if (isBinary) {
        socket.close(4001, 'Invalid message');
        return;
      }
      void this.message(session, data.toString()).catch((): void => {
        socket.close(4001, 'Unauthorized or invalid message');
      });
    });
    socket.on('error', (): void => {
      socket.terminate();
    });
    socket.once('close', (): void => {
      clearTimeout(deadline);
      this.simulations.interrupt(session.id);
      this.queue?.disconnected(session.id);
      this.sessions.delete(session.id);
    });
  }

  private async message(session: Session, raw: string): Promise<void> {
    const message = clientMessageSchema.parse(JSON.parse(raw));
    if (!session.clientId) {
      if (message.type !== 'authenticate' || session.verifying)
        throw new HttpError(401, 'Authentication required');
      session.verifying = true;
      const client = await this.signatures.verify(
        message,
        session.extensionId,
        {
          method: 'GET',
          authority: session.authority,
          target: '/ws',
          bytes: new Uint8Array(),
        },
      );
      if (session.socket.readyState !== WebSocket.OPEN) return;
      this.clients.authorized(client.id, session.extensionId);
      for (const previous of this.sessions.values())
        if (previous.clientId === client.id)
          previous.socket.close(4000, 'Replaced by reconnect');
      session.clientId = client.id;
      session.queueCapable = message.protocolVersion === 3;
      session.flowCapable = false;
      this.send(session, { type: 'authenticated' });
      this.queue?.connected();
      return;
    }
    this.clients.authorized(session.clientId, session.extensionId);
    session.lastSeen = Date.now();
    if (message.type === 'ping') this.send(session, { type: 'pong' });
    else if (message.type === 'simulation-started')
      this.simulations.transition(message.id, session.id, 'running');
    else if (message.type === 'simulation-completed')
      this.simulations.transition(message.id, session.id, 'completed');
    else if (message.type === 'queue-progress' && session.queueCapable)
      this.queue?.progress(session.clientId, session.id, message);
    else throw new HttpError(400, 'Unexpected authentication');
  }

  private send(session: Session, message: ServerMessage): void {
    if (session.socket.readyState !== WebSocket.OPEN) return;
    session.socket.send(JSON.stringify(message), (error): void => {
      if (error) {
        this.simulations.interrupt(session.id, 'send-failed');
        this.queue?.disconnected(session.id, 'send-failed');
        session.socket.terminate();
      }
    });
  }
}
