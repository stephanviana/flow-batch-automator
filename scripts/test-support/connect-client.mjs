import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, webcrypto } from 'node:crypto';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { TextEncoder } from 'node:util';
import { signaturePayload } from '../../packages/protocol/dist/index.js';

const { WebSocket } = createRequire(
  new URL('../../packages/orchestrator/package.json', import.meta.url),
)('ws');
export async function requestConnection(base, extensionId, key) {
  key ??= await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  const { kty, crv, x, y } = await webcrypto.subtle.exportKey(
    'jwk',
    key.publicKey,
  );
  const response = await fetch(`${base}/api/pairing`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Flow-Extension': extensionId,
    },
    body: JSON.stringify({ publicKey: { kty, crv, x, y } }),
  });
  assert.equal(response.status, 200);
  return { ...(await response.json()), key, extensionId };
}
export async function authenticateConnection(base, client) {
  const response = await fetch(`${base}/api/challenges`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Flow-Extension': client.extensionId,
    },
    body: JSON.stringify({
      clientId: client.clientId,
      method: 'GET',
      target: '/ws',
      bodyDigest: createHash('sha256').update('').digest('hex'),
    }),
  });
  assert.equal(response.status, 200);
  const challenge = await response.json();
  const signature = Buffer.from(
    await webcrypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      client.key.privateKey,
      new TextEncoder().encode(signaturePayload(challenge)),
    ),
  ).toString('base64url');
  const socket = new WebSocket(`${base.replace('http:', 'ws:')}/ws`, {
    origin: `chrome-extension://${client.extensionId}`,
  });
  await once(socket, 'open');
  const ready = once(socket, 'message', { signal: AbortSignal.timeout(3000) });
  socket.send(
    JSON.stringify({
      type: 'authenticate',
      clientId: client.clientId,
      challengeId: challenge.challengeId,
      signature,
    }),
  );
  const [message] = await ready;
  assert.deepEqual(JSON.parse(String(message)), { type: 'authenticated' });
  return socket;
}
