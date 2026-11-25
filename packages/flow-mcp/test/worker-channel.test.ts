import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { test } from 'node:test';
import { WebSocketServer, type WebSocket } from 'ws';
import { flowExecuteSchema, type FlowExecute } from '@flow-batch/protocol';
import { WorkerChannel } from '../src/executor/worker-channel.js';

function command(): FlowExecute {
  return flowExecuteSchema.parse({
    type: 'flow-execute',
    taskId: randomUUID(),
    attemptId: randomUUID(),
    attemptNumber: 1,
    original: {
      imagePrompt: 'Fixture',
      videoPrompt: 'Fixture',
      copy: 'Fixture',
    },
    flow: {
      projectId: randomUUID(),
      driver: 'browser-ui',
      seed: null,
      maxVideoCredits: 25,
      imageModel: 'GEM_PIX_2',
      videoModel: 'abra_i2v_8s',
      aspect: '9:16',
      reference: {
        assetId: randomUUID(),
        name: 'ref.png',
        mime: 'image/png',
        bytes: 10,
        sha256: 'a'.repeat(64),
      },
      approval: {
        approvedAt: Date.now(),
        imageGenerations: 1,
        videoGenerations: 1,
      },
    },
  });
}

test(
  'worker waits for cleanup before reporting failure and accepts the next take on the same connection',
  { timeout: 5000 },
  async (t) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    t.after(() => {
      for (const peer of server.clients) peer.terminate();
      server.close();
    });
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const authority = `127.0.0.1:${address.port}`;
    const clientId = randomUUID();
    const first = command();
    const second = command();
    const gate = new EventEmitter();
    const started = once(gate, 'started');
    const cleanup = once(gate, 'cleanup');
    const connected = once(server, 'connection').then(async ([socket]) => {
      const peer = socket as WebSocket;
      await once(peer, 'message');
      peer.send(JSON.stringify({ type: 'authenticated' }));
      return peer;
    });
    const channel = await WorkerChannel.open(
      {
        base: `http://${authority}`,
        clientId,
        proof: async () => ({
          challenge: {
            challengeId: randomUUID(),
            clientId,
            authority,
            method: 'GET',
            target: '/ws',
            bodyDigest: 'a'.repeat(64),
            nonce: 'a'.repeat(43),
            expiresAt: Date.now() + 1000,
          },
          signature: 'fixture',
        }),
      },
      {
        async run({ taskId, attemptId }, _signal, emit) {
          emit({
            type: 'queue-progress',
            taskId,
            attemptId,
            state: 'failed',
            error: {
              code: 'fixture',
              message: 'Fixture failure',
              retryable: false,
              notSubmitted: true,
            },
          });
          if (taskId === first.taskId) {
            gate.emit('started');
            await cleanup;
          }
        },
      },
      new AbortController(),
    );
    t.after(async () => {
      gate.emit('cleanup');
      await channel.close();
    });
    const peer = await connected;
    let failureReported = false;
    const failure = once(peer, 'message').then(([message]) => {
      failureReported = true;
      return String(message);
    });
    peer.send(JSON.stringify(first));
    await started;
    assert.equal(channel.busy, true);
    const pong = once(peer, 'pong');
    peer.ping();
    await pong;
    assert.equal(failureReported, false);
    gate.emit('cleanup');
    assert.equal(JSON.parse(await failure).taskId, first.taskId);
    assert.equal(channel.busy, false);
    const nextFailure = once(peer, 'message');
    peer.send(JSON.stringify(second));
    assert.equal(
      JSON.parse(String((await nextFailure)[0])).taskId,
      second.taskId,
    );
  },
);
