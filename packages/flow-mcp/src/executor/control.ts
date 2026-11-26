import { spawn } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { PairingReceipt } from '@flow-batch/protocol';
import { z } from 'zod';
import type { BrowserConfig } from '../config.js';
import { FlowBrowserError } from '../contracts.js';
import { ExecutorApi, ExecutorApiError } from './api.js';

export interface ExecutorStatus {
  clientId: string | null;
  authorized: boolean;
  connected: boolean;
  needsPairing: boolean;
}
const identityStatusSchema = z.strictObject({
  clientId: z.uuid(),
  authorized: z.boolean(),
  connected: z.boolean(),
});
export class ExecutorControl {
  constructor(
    private readonly config: BrowserConfig,
    private readonly base?: string,
  ) {}

  async pair(): Promise<PairingReceipt & { confirmationUrl: string }> {
    const api = await ExecutorApi.open(this.config.home, this.base);
    const receipt = await api.pair();
    return {
      ...receipt,
      confirmationUrl: `${api.base}/connect?request=${receipt.requestId}`,
    };
  }

  async status(): Promise<ExecutorStatus> {
    try {
      await access(join(this.config.home, 'executor-connection.json'));
      await access(join(this.config.home, 'executor-identity.json'));
    } catch {
      return {
        clientId: null,
        authorized: false,
        connected: false,
        needsPairing: true,
      };
    }
    const api = await ExecutorApi.open(this.config.home, this.base);
    try {
      const identity = identityStatusSchema.parse(
        await api.call('GET', '/api/identity'),
      );
      if (identity.clientId !== api.clientId)
        throw new FlowBrowserError(
          'executor_identity_mismatch',
          'A identidade retornada não corresponde ao executor local.',
        );
      return { ...identity, needsPairing: false };
    } catch (error) {
      if (
        error instanceof ExecutorApiError &&
        [401, 403].includes(error.status)
      )
        return {
          clientId: api.clientId,
          authorized: false,
          connected: false,
          needsPairing: true,
        };
      throw error;
    }
  }

  async start(): Promise<ExecutorStatus> {
    const status = await this.status();
    if (status.connected) return status;
    if (!status.authorized)
      throw new FlowBrowserError(
        'executor_not_authorized',
        'Use flow_browser_pair e confirme o código em /connect antes de iniciar o executor.',
      );
    try {
      await readFile(join(this.config.home, 'worker.lock'));
      throw new FlowBrowserError(
        'worker_locked',
        'A execução local anterior precisa ser conferida antes de iniciar outro processo.',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../main.js', import.meta.url)), '--worker'],
      {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          FLOW_BROWSER_HOME: this.config.home,
          ...(this.config.activeProfile
            ? { FLOW_BROWSER_PROFILE: this.config.activeProfile }
            : {}),
          ...(this.config.executable
            ? { FLOW_BROWSER_CHROME: this.config.executable }
            : {}),
          ...(this.base ? { FLOW_API_URL: this.base } : {}),
          ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        },
      },
    );
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', () =>
        reject(
          new FlowBrowserError(
            'worker_start_failed',
            'O processo do executor não iniciou.',
          ),
        ),
      );
    });
    child.unref();
    for (let round = 0; round < 30; round++) {
      await delay(200);
      const current = await this.status();
      if (current.connected) return current;
    }
    throw new FlowBrowserError(
      'worker_start_unknown',
      'A conexão do processo ainda não foi confirmada. Consulte o estado antes de iniciar outro.',
    );
  }

  async workerProcess(): Promise<{ running: boolean; pid: number | null }> {
    let raw: string;
    try {
      raw = await readFile(join(this.config.home, 'worker.lock'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { running: false, pid: null };
      throw error;
    }
    try {
      const parsed = z
        .strictObject({ pid: z.number().int().positive(), clientId: z.uuid() })
        .parse(JSON.parse(raw));
      process.kill(parsed.pid, 0);
      return { running: true, pid: parsed.pid };
    } catch {
      return { running: false, pid: null };
    }
  }

  async stop(): Promise<void> {
    const worker = await this.workerProcess();
    if (!worker.running || worker.pid === null) return;
    await writeFile(
      join(this.config.home, 'worker-stop.json'),
      JSON.stringify({ pid: worker.pid, at: Date.now() }),
      { mode: 0o600 },
    ).catch(() => {});
    if (process.platform !== 'win32') {
      try {
        process.kill(worker.pid, 'SIGTERM');
      } catch {
        return;
      }
    }
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const next = await this.workerProcess();
      if (!next.running) return;
      await delay(150);
    }
    if (process.platform === 'win32') {
      try {
        process.kill(worker.pid, 'SIGTERM');
      } catch {
        return;
      }
    }
  }

  async pause(): Promise<unknown> {
    if (!(await this.status()).authorized)
      throw new FlowBrowserError(
        'executor_not_authorized',
        'Conecte o executor em /connect antes de pausar sua fila.',
      );
    const api = await ExecutorApi.open(this.config.home, this.base);
    return api.call('POST', '/api/queue/control', { action: 'pause' });
  }
}
