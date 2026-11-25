import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, type RawData } from 'ws';
import {
  BROWSER_EXECUTOR_ID,
  BROWSER_PROTOCOL_VERSION,
  serverMessageSchema,
  clientMessageSchema,
  type FlowExecute,
  type QueueProgress,
  type QueueCheckpoint,
} from '@flow-batch/protocol';
import { FlowBrowserError } from '../contracts.js';
import type { ExecutorApi } from './api.js';
import type { BrowserTakeExecutor } from './take.js';

export class WorkerChannel {
  private authenticated = false;
  private lastPong = Date.now();
  private active: Promise<void> | undefined;
  private heartbeat: ReturnType<typeof setInterval>;
  private constructor(
    private readonly socket: WebSocket,
    private readonly executor: Pick<BrowserTakeExecutor, 'run'>,
    private readonly controller: AbortController,
  ) {
    socket.on('error', () => controller.abort());
    socket.on('close', () => controller.abort());
    socket.on('message', (raw) => this.receive(raw));
    this.heartbeat = setInterval(() => this.ping(), 15000);
  }

  static async open(
    api: Pick<ExecutorApi, 'base' | 'clientId' | 'proof'>,
    executor: Pick<BrowserTakeExecutor, 'run'>,
    controller: AbortController,
  ): Promise<WorkerChannel> {
    const proof = await api.proof('GET', '/ws');
    const socket = new WebSocket(api.base.replace('http:', 'ws:') + '/ws', {
      origin: api.base,
      headers: { 'X-Flow-Executor': BROWSER_EXECUTOR_ID },
    });
    const channel = new WorkerChannel(socket, executor, controller);
    socket.on('open', () =>
      socket.send(
        JSON.stringify({
          type: 'authenticate',
          clientId: api.clientId,
          challengeId: proof.challenge.challengeId,
          signature: proof.signature,
          protocolVersion: BROWSER_PROTOCOL_VERSION,
        }),
      ),
    );
    try {
      await channel.waitForAuthentication();
      return channel;
    } catch (error) {
      await channel.close();
      throw error;
    }
  }

  get busy(): boolean {
    return this.active !== undefined;
  }

  private async waitForAuthentication(): Promise<void> {
    const deadline = Date.now() + 7000;
    while (
      !this.authenticated &&
      !this.controller.signal.aborted &&
      Date.now() < deadline
    )
      await delay(100);
    if (!this.authenticated)
      throw new FlowBrowserError(
        'worker_auth_failed',
        'A conexão do executor não foi confirmada. Confira /connect.',
      );
  }

  private receive(raw: RawData): void {
    try {
      const message = serverMessageSchema.parse(JSON.parse(raw.toString()));
      if (message.type === 'authenticated') {
        this.authenticated = true;
        this.lastPong = Date.now();
      } else if (message.type === 'pong') this.lastPong = Date.now();
      else if (message.type === 'revoked') this.controller.abort();
      else if (message.type === 'flow-execute' && this.authenticated)
        this.execute(message);
      else this.socket.close(4001, 'Unsupported execution');
    } catch {
      this.socket.close(4001, 'Invalid message');
    }
  }

  private execute(command: FlowExecute): void {
    if (this.active) {
      this.socket.close(4001, 'Executor already active');
      return;
    }
    let terminal: QueueProgress | undefined;
    this.active = this.executor
      .run(command, this.controller.signal, (event) => {
        if (
          event.type === 'queue-progress' &&
          (event.state === 'completed' ||
            event.state === 'failed' ||
            event.state === 'uncertain')
        )
          terminal = event;
        else this.send(event);
      })
      .then(() => {
        this.active = undefined;
        if (!terminal)
          throw new Error('Execution ended without a terminal event');
        this.send(terminal);
      })
      .catch(() => {
        this.active = undefined;
        this.socket.close(4001, 'Execution result requires review');
      });
  }

  private send(event: QueueProgress | QueueCheckpoint): void {
    if (
      this.socket.readyState === WebSocket.OPEN &&
      !this.controller.signal.aborted
    )
      this.socket.send(JSON.stringify(clientMessageSchema.parse(event)));
  }

  private ping(): void {
    if (Date.now() - this.lastPong > 45000) {
      this.socket.close(4008, 'Heartbeat timeout');
      return;
    }
    if (this.authenticated && this.socket.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify({ type: 'ping' }));
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    this.socket.close();
    if (this.active) await Promise.race([this.active, delay(1000)]);
  }
}
