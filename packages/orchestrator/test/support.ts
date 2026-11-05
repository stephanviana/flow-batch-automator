import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import type { TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  pairingReceiptSchema,
  challengeSchema,
  signaturePayload,
  type Challenge,
  type PairingReceipt,
} from '@flow-batch/protocol';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { instructions } from './instruction-fixture.js';
import { bodyDigest } from '../src/security/signatures.js';

export async function fixture(context: TestContext): Promise<{
  app: ReturnType<typeof createApp>;
  config: ReturnType<typeof loadConfig>;
  database: DatabaseSync;
  key: webcrypto.CryptoKeyPair;
  publicKey: { kty: 'EC'; crv: 'P-256'; x: string; y: string };
  extensionId: string;
  headers: { host: string; 'x-flow-extension': string };
}> {
  const directory = mkdtempSync(join(tmpdir(), 'flow-connection-'));
  const config = loadConfig({
    DATABASE_PATH: join(directory, 'db.sqlite'),
    LIBRARY_DIR: join(directory, 'instructions'),
    LOG_LEVEL: 'silent',
  });
  instructions.installInstructions(config.libraryDirectory);
  const app = createApp(config);
  const database = new DatabaseSync(config.databasePath);
  context.after(async (): Promise<void> => {
    await app.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const key = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  const exported = await webcrypto.subtle.exportKey('jwk', key.publicKey);
  const extensionId = 'a'.repeat(32);
  assert.ok(exported.x && exported.y);
  return {
    app,
    config,
    database,
    key,
    publicKey: { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y },
    extensionId,
    headers: { host: '127.0.0.1:4319', 'x-flow-extension': extensionId },
  };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;

export async function pair(f: Fixture): Promise<PairingReceipt> {
  const response = await f.app.inject({
    method: 'POST',
    url: '/api/pairing',
    headers: f.headers,
    payload: { publicKey: f.publicKey },
  });
  assert.equal(response.statusCode, 200, response.body);
  return pairingReceiptSchema.parse(response.json());
}
export async function management(f: Fixture): Promise<Record<string, string>> {
  const page = await f.app.inject({
    url: '/connect',
    headers: { host: f.headers.host },
  });
  return {
    host: f.headers.host,
    origin: 'http://127.0.0.1:4319',
    'x-flow-management': '1',
    cookie: String(page.headers['set-cookie']).split(';')[0] ?? '',
  };
}
export async function approve(
  f: Fixture,
  receipt: PairingReceipt,
): Promise<Record<string, string>> {
  const headers = await management(f);
  const response = await f.app.inject({
    method: 'POST',
    url: `/manage/requests/${receipt.requestId}`,
    headers,
    payload: { approve: true },
  });
  assert.equal(response.statusCode, 200, response.body);
  return headers;
}
export async function signed(
  f: Fixture,
  clientId: string,
  method: 'GET' | 'POST',
  target: Challenge['target'],
  body = '',
): Promise<{
  challenge: Challenge;
  signature: string;
  headers: Record<string, string>;
}> {
  const response = await f.app.inject({
    method: 'POST',
    url: '/api/challenges',
    headers: f.headers,
    payload: {
      clientId,
      method,
      target,
      bodyDigest: bodyDigest(Buffer.from(body)),
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  const challenge = challengeSchema.parse(response.json());
  const signature = Buffer.from(
    await webcrypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      f.key.privateKey,
      new TextEncoder().encode(signaturePayload(challenge)),
    ),
  ).toString('base64url');
  return {
    challenge,
    signature,
    headers: {
      ...f.headers,
      'x-flow-client': clientId,
      'x-flow-challenge': challenge.challengeId,
      'x-flow-signature': signature,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
  };
}
