import assert from 'node:assert/strict';
import { randomUUID, webcrypto } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import {
  BROWSER_EXECUTOR_ID,
  challengeSchema,
  pairingReceiptSchema,
  signaturePayload,
  type Challenge,
} from '@flow-batch/protocol';
import { fixture, approve, type Fixture } from './support.js';
import { bodyDigest } from '../src/security/signatures.js';
import { flowInput } from './flow-support.js';

function nativeHeaders(f: Fixture): Record<string, string> {
  return { host: f.headers.host, 'x-flow-executor': BROWSER_EXECUTOR_ID };
}
async function nativeProof(
  f: Fixture,
  clientId: string,
  target: Challenge['target'],
  body = '',
): Promise<Record<string, string>> {
  const method = body ? 'POST' : 'GET';
  const issued = await f.app.inject({
    method: 'POST',
    url: '/api/challenges',
    headers: nativeHeaders(f),
    payload: {
      clientId,
      method,
      target,
      bodyDigest: bodyDigest(Buffer.from(body)),
    },
  });
  assert.equal(issued.statusCode, 200, issued.body);
  const challenge = challengeSchema.parse(issued.json());
  const signature = Buffer.from(
    await webcrypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      f.key.privateKey,
      new TextEncoder().encode(signaturePayload(challenge)),
    ),
  ).toString('base64url');
  return {
    ...nativeHeaders(f),
    'x-flow-client': clientId,
    'x-flow-challenge': challenge.challengeId,
    'x-flow-signature': signature,
    ...(body ? { 'content-type': 'application/json' } : {}),
  };
}

test('native executor requires explicit pairing, exact signed bytes and revocation takes effect immediately', async (t) => {
  const f = await fixture(t);
  const pairing = await f.app.inject({
    method: 'POST',
    url: '/api/pairing',
    headers: nativeHeaders(f),
    payload: { publicKey: f.publicKey },
  });
  assert.equal(pairing.statusCode, 200, pairing.body);
  const receipt = pairingReceiptSchema.parse(pairing.json());
  const unauthorized = await f.app.inject({
    method: 'POST',
    url: '/api/challenges',
    headers: nativeHeaders(f),
    payload: {
      clientId: receipt.clientId,
      method: 'GET',
      target: '/api/identity',
      bodyDigest: bodyDigest(),
    },
  });
  assert.equal(unauthorized.statusCode, 401);
  const management = await approve(f, receipt);
  const headers = await nativeProof(f, receipt.clientId, '/api/identity');
  assert.equal(
    (await f.app.inject({ url: '/api/identity', headers })).statusCode,
    200,
  );
  assert.equal(
    (await f.app.inject({ url: '/api/identity', headers })).statusCode,
    401,
  );
  const body = JSON.stringify({ action: 'pause' });
  const signed = await nativeProof(
    f,
    receipt.clientId,
    '/api/queue/control',
    body,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/queue/control',
        headers: signed,
        payload: JSON.stringify({ action: 'start' }),
      })
    ).statusCode,
    401,
  );
  await f.app.inject({
    method: 'POST',
    url: `/manage/clients/${receipt.clientId}/revoke`,
    headers: management,
    payload: {},
  });
  const revoked = await f.app.inject({
    method: 'POST',
    url: '/api/challenges',
    headers: nativeHeaders(f),
    payload: {
      clientId: receipt.clientId,
      method: 'GET',
      target: '/api/identity',
      bodyDigest: bodyDigest(),
    },
  });
  assert.equal(revoked.statusCode, 403);
});

test('native headers cannot impersonate extension identity or accept an arbitrary Origin', async (t) => {
  const f = await fixture(t);
  for (const headers of [
    { ...nativeHeaders(f), origin: 'https://hostile.test' },
    { ...nativeHeaders(f), 'x-flow-extension': f.extensionId },
    { ...nativeHeaders(f), 'x-flow-executor': 'other-executor' },
    { ...nativeHeaders(f), origin: `chrome-extension://${f.extensionId}` },
  ])
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/pairing',
          headers,
          payload: { publicKey: f.publicKey },
        })
      ).statusCode,
      403,
    );
});

test('native queue accepts only browser driver contracts and websocket authenticates with v9', async (t) => {
  const f = await fixture(t);
  const pairing = await f.app.inject({
    method: 'POST',
    url: '/api/pairing',
    headers: nativeHeaders(f),
    payload: { publicKey: f.publicKey },
  });
  const receipt = pairingReceiptSchema.parse(pairing.json());
  await approve(f, receipt);
  const legacy = flowInput();
  const invalidBody = JSON.stringify({
    requestId: randomUUID(),
    tasks: [legacy],
  });
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/queue',
        headers: await nativeProof(
          f,
          receipt.clientId,
          '/api/queue',
          invalidBody,
        ),
        payload: invalidBody,
      })
    ).statusCode,
    409,
  );
  await f.app.listen({ host: '127.0.0.1', port: 0 });
  const address = f.app.server.address();
  assert.ok(address && typeof address !== 'string');
  const headers = await nativeProof(f, receipt.clientId, '/ws');
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
    origin: `http://${f.headers.host}`,
    headers: nativeHeaders(f),
  });
  t.after(() => socket.terminate());
  await once(socket, 'open');
  const response = once(socket, 'message');
  socket.send(
    JSON.stringify({
      type: 'authenticate',
      clientId: receipt.clientId,
      challengeId: headers['x-flow-challenge'],
      signature: headers['x-flow-signature'],
      protocolVersion: 9,
    }),
  );
  assert.deepEqual(JSON.parse(String((await response)[0])), {
    type: 'authenticated',
  });
});
