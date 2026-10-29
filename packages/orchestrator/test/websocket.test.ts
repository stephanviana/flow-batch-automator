import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { serverMessageSchema, type ServerMessage } from '@flow-batch/protocol';
import { fixture, pair, approve, signed, type Fixture } from './support.js';
import { SimulationStore } from '../src/persistence/simulations.js';

async function next(socket: WebSocket): Promise<ServerMessage> {
  const [data] = await once(socket, 'message', {
    signal: AbortSignal.timeout(3000),
  });
  return serverMessageSchema.parse(JSON.parse(String(data)));
}
async function socketFor(f: Fixture, clientId: string): Promise<WebSocket> {
  if (!f.app.server.listening)
    await f.app.listen({ host: '127.0.0.1', port: 0 });
  const address = f.app.server.address();
  assert.ok(address && typeof address !== 'string');
  const proof = await signed(f, clientId, 'GET', '/ws');
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
    headers: {
      host: f.headers.host,
      origin: `chrome-extension://${f.extensionId}`,
    },
  });
  await once(socket, 'open');
  const authenticated = next(socket);
  socket.send(
    JSON.stringify({
      type: 'authenticate',
      clientId,
      challengeId: proof.challenge.challengeId,
      signature: proof.signature,
    }),
  );
  assert.deepEqual(await authenticated, { type: 'authenticated' });
  return socket;
}

test('real WebSocket authenticates, heartbeats, completes simulation and deduplicates HTTP requests', async (t) => {
  const f = await fixture(t);
  const receipt = await pair(f);
  await approve(f, receipt);
  const socket = await socketFor(f, receipt.clientId);
  t.after(() => socket.terminate());
  const pong = next(socket);
  socket.send(JSON.stringify({ type: 'ping' }));
  assert.deepEqual(await pong, { type: 'pong' });
  const body = JSON.stringify({ requestId: randomUUID(), durationMs: 100 });
  const proof = await signed(
    f,
    receipt.clientId,
    'POST',
    '/api/simulations',
    body,
  );
  const incoming = next(socket);
  const response = await f.app.inject({
    method: 'POST',
    url: '/api/simulations',
    headers: proof.headers,
    payload: body,
  });
  assert.equal(response.statusCode, 200);
  const message = await incoming;
  assert.equal(message.type, 'simulate');
  if (message.type !== 'simulate') return;
  socket.send(JSON.stringify({ type: 'simulation-started', id: message.id }));
  socket.send(JSON.stringify({ type: 'simulation-completed', id: message.id }));
  await delay(40);
  const duplicate = await signed(
    f,
    receipt.clientId,
    'POST',
    '/api/simulations',
    body,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/simulations',
        headers: duplicate.headers,
        payload: body,
      })
    ).json<{ state: string }>().state,
    'completed',
  );
  assert.equal(
    f.database.prepare('SELECT COUNT(*) AS count FROM simulations').get()
      ?.count,
    1,
  );
  assert.equal(
    f.database.prepare('SELECT COUNT(*) AS count FROM simulation_events').get()
      ?.count,
    3,
  );
});

test('disconnect interrupts simulations; reconnect never resends; revocation closes the live socket', async (t) => {
  const f = await fixture(t);
  const receipt = await pair(f);
  const management = await approve(f, receipt);
  let socket = await socketFor(f, receipt.clientId);
  t.after(() => socket.terminate());
  const body = JSON.stringify({ requestId: randomUUID(), durationMs: 5000 });
  const proof = await signed(
    f,
    receipt.clientId,
    'POST',
    '/api/simulations',
    body,
  );
  const incoming = next(socket);
  await f.app.inject({
    method: 'POST',
    url: '/api/simulations',
    headers: proof.headers,
    payload: body,
  });
  const message = await incoming;
  assert.equal(message.type, 'simulate');
  if (message.type !== 'simulate') return;
  socket.send(JSON.stringify({ type: 'simulation-started', id: message.id }));
  const closed = once(socket, 'close');
  socket.close();
  await closed;
  await delay(40);
  assert.equal(
    new SimulationStore(f.database).get(message.id).state,
    'interrupted',
  );
  socket = await socketFor(f, receipt.clientId);
  const received: unknown[] = [];
  socket.on('message', (data): void => {
    received.push(data);
  });
  await delay(100);
  assert.equal(received.length, 0);
  const revoked = next(socket);
  const revokedClose = once(socket, 'close');
  await f.app.inject({
    method: 'POST',
    url: `/manage/clients/${receipt.clientId}/revoke`,
    headers: management,
    payload: {},
  });
  assert.deepEqual(await revoked, { type: 'revoked' });
  assert.equal((await revokedClose)[0], 4003);
});

test('WebSocket rejects web origin, missing first proof, credentials in URL and auth timeout', async (t) => {
  const f = await fixture(t);
  await f.app.listen({ host: '127.0.0.1', port: 0 });
  const address = f.app.server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `ws://127.0.0.1:${address.port}/ws`;
  for (const [target, origin] of [
    [url, 'https://example.com'],
    [url + '?proof=forbidden', `chrome-extension://${f.extensionId}`],
  ] as const) {
    const socket = new WebSocket(target, {
      headers: { host: f.headers.host, origin },
    });
    await assert.rejects(once(socket, 'open'), /403/);
    socket.terminate();
  }
  const socket = new WebSocket(url, {
    headers: {
      host: f.headers.host,
      origin: `chrome-extension://${f.extensionId}`,
    },
  });
  await once(socket, 'open');
  const closed = once(socket, 'close');
  socket.send(JSON.stringify({ type: 'ping' }));
  assert.equal((await closed)[0], 4001);
  const idle = new WebSocket(url, {
    headers: {
      host: f.headers.host,
      origin: `chrome-extension://${f.extensionId}`,
    },
  });
  await once(idle, 'open');
  const [code] = await once(idle, 'close', {
    signal: AbortSignal.timeout(6500),
  });
  assert.equal(code, 4008);
});
