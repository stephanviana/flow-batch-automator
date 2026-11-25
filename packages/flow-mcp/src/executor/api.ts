import { createHash, webcrypto, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  BROWSER_EXECUTOR_ID,
  challengeSchema,
  pairingReceiptSchema,
  signaturePayload,
  type Challenge,
  type PairingReceipt,
} from '@flow-batch/protocol';
import { executorIdentity, type ExecutorIdentity } from './identity.js';
import { FlowBrowserError } from '../contracts.js';

const connectionSchema = z.strictObject({
  base: z.string(),
  clientId: z.uuid(),
});
export class ExecutorApiError extends FlowBrowserError {
  constructor(readonly status: number) {
    super(
      status === 403 ? 'executor_revoked' : 'executor_api_failed',
      `A API local recusou a operação (HTTP ${status}). Confira a conexão e as autorizações no painel.`,
    );
  }
}

export class ExecutorApi {
  private client: string | undefined;
  readonly base: string;
  private constructor(
    private readonly home: string,
    base: string,
    private readonly identity: ExecutorIdentity,
  ) {
    const url = new URL(base);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new FlowBrowserError(
        'executor_api_invalid',
        'Use apenas a API HTTP local, sem credenciais ou caminhos adicionais.',
      );
    this.base = url.origin;
  }

  static async open(
    home: string,
    base = 'http://127.0.0.1:4319',
  ): Promise<ExecutorApi> {
    const api = new ExecutorApi(home, base, await executorIdentity(home));
    try {
      const stored = connectionSchema.parse(
        JSON.parse(
          await readFile(join(home, 'executor-connection.json'), 'utf8'),
        ),
      );
      if (stored.base === api.base) api.client = stored.clientId;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new FlowBrowserError(
          'executor_connection_invalid',
          'A conexão local salva é inválida. Confira o estado do executor.',
        );
    }
    return api;
  }

  get clientId(): string {
    if (!this.client)
      throw new FlowBrowserError(
        'executor_not_paired',
        'Use pnpm flow:pair e confirme a conexão em /connect.',
      );
    return this.client;
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body = '',
    headers: Record<string, string> = {},
  ): Promise<unknown> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {
        'X-Flow-Executor': BROWSER_EXECUTOR_ID,
        ...headers,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ExecutorApiError(response.status);
    }
    return response.json() as Promise<unknown>;
  }

  async pair(): Promise<PairingReceipt> {
    const receipt = pairingReceiptSchema.parse(
      await this.request(
        '/api/pairing',
        'POST',
        JSON.stringify({ publicKey: this.identity.publicKey }),
      ),
    );
    const staging = join(this.home, `.connection-${randomUUID()}.tmp`);
    try {
      await writeFile(
        staging,
        JSON.stringify({ base: this.base, clientId: receipt.clientId }),
        { flag: 'wx', mode: 0o600 },
      );
      await rename(staging, join(this.home, 'executor-connection.json'));
    } finally {
      await unlink(staging).catch(() => {});
    }
    this.client = receipt.clientId;
    return receipt;
  }

  async proof(
    method: 'GET' | 'POST',
    target: Challenge['target'],
    body = '',
  ): Promise<{ challenge: Challenge; signature: string }> {
    const bodyDigest = createHash('sha256').update(body).digest('hex');
    const challenge = challengeSchema.parse(
      await this.request(
        '/api/challenges',
        'POST',
        JSON.stringify({ clientId: this.clientId, method, target, bodyDigest }),
      ),
    );
    if (
      challenge.clientId !== this.clientId ||
      challenge.method !== method ||
      challenge.target !== target ||
      challenge.bodyDigest !== bodyDigest ||
      challenge.authority !== new URL(this.base).host
    )
      throw new FlowBrowserError(
        'executor_challenge_invalid',
        'A prova recebida não corresponde à operação local.',
      );
    const signature = await webcrypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      this.identity.privateKey,
      new TextEncoder().encode(signaturePayload(challenge)),
    );
    return {
      challenge,
      signature: Buffer.from(signature).toString('base64url'),
    };
  }

  async call(
    method: 'GET' | 'POST',
    target: Exclude<Challenge['target'], '/ws'>,
    payload?: unknown,
  ): Promise<unknown> {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const proof = await this.proof(method, target, body);
    return this.request(target, method, body, {
      'X-Flow-Client': this.clientId,
      'X-Flow-Challenge': proof.challenge.challengeId,
      'X-Flow-Signature': proof.signature,
    });
  }
}
