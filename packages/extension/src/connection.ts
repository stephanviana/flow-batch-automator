import {
  LOCAL_SERVER_URL,
  serverMessageSchema,
  type PairingReceipt,
} from '@flow-batch/protocol';
import { ApiError, beginPairing, proof, signedRequest } from './api.js';
import { preferences, savePreferences, setState } from './state.js';
import { QueueExecutor } from './queue-executor.js';

export class ExtensionConnection {
  private readonly queueExecutor = new QueueExecutor();
  private socket: WebSocket | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly simulations = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private recovering = false;
  private generation = 0;
  private attempts = 0;
  private lastPong = 0;

  async connect(): Promise<void> {
    await this.disconnect();
    const receipt = await beginPairing();
    await savePreferences({
      enabled: true,
      revoked: false,
      clientId: receipt.clientId,
      pending: receipt,
    });
    await setState({
      phase: 'pending',
      message: 'Compare os códigos e confirme na página local.',
      code: receipt.code,
      expiresAt: receipt.expiresAt,
    });
    await chrome.alarms.create('flow-recover', { periodInMinutes: 0.5 });
    await chrome.tabs.create({
      url: `${LOCAL_SERVER_URL}/connect?request=${receipt.requestId}`,
    });
    void this.recover();
  }

  async disconnect(): Promise<void> {
    this.stop();
    const previous = await preferences();
    await savePreferences({ ...previous, enabled: false });
    await chrome.alarms.clear('flow-recover');
    await setState({
      phase: previous.revoked ? 'revoked' : 'disconnected',
      message: previous.revoked
        ? 'Acesso revogado. Conecte e autorize novamente.'
        : 'Desconectada. A autorização foi preservada.',
    });
  }

  async reconnect(): Promise<void> {
    const config = await preferences();
    if (config.revoked || !config.clientId) {
      await setState({
        phase: 'revoked',
        message: 'Clique em Conectar e confirme uma nova autorização.',
      });
      return;
    }
    this.stop();
    delete config.retryAt;
    await savePreferences({ ...config, enabled: true });
    await this.recover();
  }

  async recover(): Promise<void> {
    if (this.recovering || this.socket) return;
    this.recovering = true;
    const generation = this.generation;
    try {
      const config = await preferences();
      if (!config.enabled || config.revoked || !config.clientId) return;
      await chrome.alarms.create('flow-recover', { periodInMinutes: 0.5 });
      if (config.retryAt && config.retryAt > Date.now()) {
        this.schedule(config.retryAt - Date.now());
        return;
      }
      if (config.pending && config.pending.expiresAt <= Date.now()) {
        await savePreferences({ ...config, enabled: false });
        await chrome.alarms.clear('flow-recover');
        await setState({
          phase: 'error',
          message: 'Solicitação expirada. Clique em Conectar novamente.',
        });
        return;
      }
      await signedRequest(config.clientId, 'GET', '/api/identity');
      if (generation !== this.generation) return;
      const signed = await proof(config.clientId, 'GET', '/ws');
      if (generation !== this.generation) return;
      const next = { ...config };
      delete next.pending;
      delete next.retryAt;
      await savePreferences(next);
      if (generation !== this.generation) return;
      this.openSocket(config.clientId, signed);
    } catch (error) {
      if (generation === this.generation) await this.failure(error);
    } finally {
      this.recovering = false;
    }
  }

  private openSocket(
    clientId: string,
    signed: Awaited<ReturnType<typeof proof>>,
  ): void {
    const socket = new WebSocket(
      LOCAL_SERVER_URL.replace('http:', 'ws:') + '/ws',
    );
    this.socket = socket;
    void setState({ phase: 'connecting', message: 'Autenticando conexão…' });
    const deadline = setTimeout((): void => {
      if (this.socket === socket && !this.heartbeat)
        socket.close(4008, 'Authentication timeout');
    }, 7000);
    socket.onopen = (): void =>
      socket.send(
        JSON.stringify({
          type: 'authenticate',
          clientId,
          challengeId: signed.challenge.challengeId,
          signature: signed.signature,
          protocolVersion: 5,
        }),
      );
    socket.onmessage = (event: MessageEvent<string>): void => {
      if (this.socket !== socket) return;
      try {
        this.message(socket, event.data);
      } catch {
        socket.close(4001, 'Invalid server message');
      }
    };
    socket.onclose = (event): void => {
      clearTimeout(deadline);
      if (this.socket !== socket) return;
      this.stop();
      if (event.code === 4003) void this.revoked();
      else void this.failure(new Error('Socket closed'));
    };
    socket.onerror = (): void => {
      socket.close();
    };
  }

  private message(socket: WebSocket, raw: string): void {
    const message = serverMessageSchema.parse(JSON.parse(raw));
    if (message.type === 'revoked') {
      void this.revoked();
      return;
    }
    if (message.type === 'queue-execute' || message.type === 'flow-execute') {
      this.queueExecutor.run(message, socket);
      return;
    }
    if (message.type === 'authenticated') {
      this.attempts = 0;
      this.lastPong = Date.now();
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval((): void => {
        if (Date.now() - this.lastPong > 45000) {
          socket.close(4008, 'Heartbeat timeout');
          return;
        }
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ type: 'ping' }));
      }, 20000);
      void setState({
        phase: 'connected',
        message: 'Conectada e autenticada.',
      });
    } else if (message.type === 'pong') this.lastPong = Date.now();
    else if (message.type === 'simulate' && !this.simulations.has(message.id)) {
      socket.send(
        JSON.stringify({ type: 'simulation-started', id: message.id }),
      );
      const timer = setTimeout((): void => {
        this.simulations.delete(message.id);
        if (this.socket === socket && socket.readyState === WebSocket.OPEN)
          socket.send(
            JSON.stringify({ type: 'simulation-completed', id: message.id }),
          );
      }, message.durationMs);
      this.simulations.set(message.id, timer);
    }
  }

  private async failure(error: unknown): Promise<void> {
    const generation = this.generation;
    const config = await preferences();
    if (generation !== this.generation) return;
    if (!config.enabled || config.revoked) return;
    // A pending request was explicitly initiated by the user to reauthorize.
    // Preserve its comparison code while the old authorization is still revoked.
    if (error instanceof ApiError && error.status === 403 && !config.pending) {
      await this.revoked();
      return;
    }
    if (error instanceof ApiError && error.status === 401 && !config.pending) {
      await savePreferences({ ...config, enabled: false });
      await chrome.alarms.clear('flow-recover');
      await setState({
        phase: 'error',
        message: 'Autorização indisponível. Clique em Conectar novamente.',
      });
      return;
    }
    const delay = config.pending
      ? 2000
      : Math.min(30000, 1000 * 2 ** Math.min(this.attempts++, 5)) +
        Math.random() * 500;
    await savePreferences({ ...config, retryAt: Date.now() + delay });
    if (generation !== this.generation) return;
    await this.waitingState(config.pending);
    if (generation !== this.generation) return;
    this.schedule(delay);
  }

  private async waitingState(pending?: PairingReceipt): Promise<void> {
    await setState(
      pending
        ? {
            phase: 'pending',
            message: 'Compare os códigos e confirme na página local.',
            code: pending.code,
            expiresAt: pending.expiresAt,
          }
        : {
            phase: 'reconnecting',
            message: 'Sem resposta. Reconectando com espera progressiva…',
          },
    );
  }

  private schedule(delay: number): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout((): void => {
      void this.recover();
    }, delay);
  }

  private async revoked(): Promise<void> {
    this.stop();
    const config = await preferences();
    await savePreferences({ ...config, enabled: false, revoked: true });
    await chrome.alarms.clear('flow-recover');
    await setState({
      phase: 'revoked',
      message: 'Acesso revogado. Tentativas automáticas interrompidas.',
    });
  }

  private stop(): void {
    this.queueExecutor.stop();
    this.generation++;
    const previous = this.socket;
    this.socket = undefined;
    previous?.close();
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    clearTimeout(this.retryTimer);
    for (const timer of this.simulations.values()) clearTimeout(timer);
    this.simulations.clear();
  }
}
