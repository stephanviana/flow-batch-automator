import { createHash, randomBytes, randomUUID, webcrypto } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyRequest } from 'fastify';
import {
  challengeSchema,
  extensionIdSchema,
  signaturePayload,
  type Challenge,
} from '@flow-batch/protocol';
import type { ClientStore, Client } from '../persistence/clients.js';
import { HttpError } from './errors.js';

export function extensionIdentity(request: FastifyRequest): string {
  const extensionId = extensionIdSchema.parse(
    request.headers['x-flow-extension'],
  );
  if (
    request.headers.origin &&
    request.headers.origin !== `chrome-extension://${extensionId}`
  )
    throw new HttpError(403, 'Origin mismatch');
  return extensionId;
}

export function bodyDigest(bytes: Uint8Array = new Uint8Array()): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class SignatureService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly clients: ClientStore,
  ) {}

  issue(
    input: Omit<Challenge, 'challengeId' | 'nonce' | 'expiresAt' | 'authority'>,
    extensionId: string,
    authority: string,
    now = Date.now(),
  ): Challenge {
    this.clients.authorized(input.clientId, extensionId);
    this.database
      .prepare('DELETE FROM challenges WHERE expires_at <= ?')
      .run(now);
    const count = this.database
      .prepare('SELECT COUNT(*) AS count FROM challenges WHERE client_id = ?')
      .get(input.clientId);
    if (Number(count?.count) >= 16)
      throw new HttpError(429, 'Too many challenges');
    const challenge: Challenge = {
      ...input,
      authority,
      challengeId: randomUUID(),
      nonce: randomBytes(32).toString('base64url'),
      expiresAt: now + 60000,
    };
    this.database
      .prepare(
        'INSERT INTO challenges (id,client_id,payload,expires_at) VALUES (?,?,?,?)',
      )
      .run(
        challenge.challengeId,
        challenge.clientId,
        JSON.stringify(challenge),
        challenge.expiresAt,
      );
    return challenge;
  }

  async verify(
    proof: { clientId: string; challengeId: string; signature: string },
    extensionId: string,
    context: {
      method: string;
      authority: string;
      target: string;
      bytes: Uint8Array;
    },
    now = Date.now(),
  ): Promise<Client> {
    const client = this.clients.authorized(proof.clientId, extensionId);
    // DELETE is synchronous and atomic. Consume before the first asynchronous verify.
    const row = this.database
      .prepare(
        'DELETE FROM challenges WHERE id = ? AND client_id = ? RETURNING payload,expires_at',
      )
      .get(proof.challengeId, proof.clientId);
    if (!row || Number(row.expires_at) <= now)
      throw new HttpError(401, 'Challenge expired or consumed');
    const challenge = challengeSchema.parse(JSON.parse(String(row.payload)));
    if (
      challenge.method !== context.method ||
      challenge.authority !== context.authority ||
      challenge.target !== context.target ||
      challenge.bodyDigest !== bodyDigest(context.bytes)
    )
      throw new HttpError(401, 'Signature context mismatch');
    if (!/^[A-Za-z0-9_-]{86}$/.test(proof.signature))
      throw new HttpError(401, 'Invalid signature');
    const key = await webcrypto.subtle.importKey(
      'jwk',
      client.publicKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const valid = await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      Buffer.from(proof.signature, 'base64url'),
      new TextEncoder().encode(signaturePayload(challenge)),
    );
    if (!valid) throw new HttpError(401, 'Invalid signature');
    return this.clients.authorized(client.id, extensionId);
  }

  async http(request: FastifyRequest): Promise<Client> {
    if (request.body !== undefined && !request.rawBody)
      throw new HttpError(400, 'JSON body required');
    const header = (name: string): string => {
      const value = request.headers[name];
      if (typeof value !== 'string') throw new HttpError(401, 'Missing proof');
      return value;
    };
    return this.verify(
      {
        clientId: header('x-flow-client'),
        challengeId: header('x-flow-challenge'),
        signature: header('x-flow-signature'),
      },
      extensionIdentity(request),
      {
        method: request.method,
        authority: request.headers.host ?? '',
        target: request.raw.url ?? '',
        bytes: request.rawBody ?? new Uint8Array(),
      },
    );
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}
