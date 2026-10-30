import {
  challengeSchema,
  LOCAL_SERVER_URL,
  pairingReceiptSchema,
  publicKeySchema,
  signaturePayload,
  type Challenge,
  type PairingReceipt,
} from '@flow-batch/protocol';
import { getIdentity } from './identity.js';

export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`Local server request failed (${status})`);
  }
}

async function request(path: string, options: RequestInit): Promise<unknown> {
  const response = await fetch(`${LOCAL_SERVER_URL}${path}`, {
    ...options,
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: { 'X-Flow-Extension': chrome.runtime.id, ...options.headers },
  });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<unknown>;
}

async function digest(body: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(body),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function beginPairing(): Promise<PairingReceipt> {
  const identity = await getIdentity();
  const exported = await crypto.subtle.exportKey('jwk', identity.publicKey);
  const publicKey = publicKeySchema.parse({
    kty: exported.kty,
    crv: exported.crv,
    x: exported.x,
    y: exported.y,
  });
  return pairingReceiptSchema.parse(
    await request('/api/pairing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey }),
    }),
  );
}

export async function proof(
  clientId: string,
  method: 'GET' | 'POST',
  target: Challenge['target'],
  body = '',
): Promise<{ challenge: Challenge; signature: string }> {
  const challenge = challengeSchema.parse(
    await request('/api/challenges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        method,
        target,
        bodyDigest: await digest(body),
      }),
    }),
  );
  if (
    challenge.clientId !== clientId ||
    challenge.method !== method ||
    challenge.target !== target ||
    challenge.authority !== new URL(LOCAL_SERVER_URL).host ||
    challenge.bodyDigest !== (await digest(body))
  )
    throw new Error('Invalid challenge context');
  const identity = await getIdentity();
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identity.privateKey,
    new TextEncoder().encode(signaturePayload(challenge)),
  );
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return { challenge, signature: encoded };
}

export async function signedRequest(
  clientId: string,
  method: 'GET' | 'POST',
  target: Exclude<Challenge['target'], '/ws'>,
  payload?: unknown,
): Promise<unknown> {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const signed = await proof(clientId, method, target, body);
  return request(target, {
    method,
    headers: {
      'X-Flow-Client': clientId,
      'X-Flow-Challenge': signed.challenge.challengeId,
      'X-Flow-Signature': signed.signature,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body } : {}),
  });
}
