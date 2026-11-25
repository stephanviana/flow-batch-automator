import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { flowExecuteSchema } from '@flow-batch/protocol';
import { QueueExecutor } from '../src/queue-executor.js';
import type { FlowRpcRequest } from '../src/flow-rpc-contract.js';

for (const scenario of [
  {
    name: 'a real take rejected by the status poll stops after one video submission',
    code: 'flow_unsafe_generation',
    sent: true,
    state: 'failed',
  },
  {
    name: 'a verification block before submission cannot request an automatic retry',
    code: 'flow_unusual_activity',
    sent: false,
    state: 'failed',
  },
  {
    name: 'a server activity block after submission remains uncertain without resubmission',
    code: 'flow_unusual_activity',
    sent: true,
    state: 'uncertain',
  },
])
  test(scenario.name, async (t) => {
    const projectId = randomUUID(),
      mediaId = randomUUID(),
      workflowId = randomUUID();
    const rpcIds: string[] = [];
    const messages: {
      state?: string;
      error?: { code: string; notSubmitted: boolean; retryable: boolean };
    }[] = [];
    const storedChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    t.after(() => {
      if (storedChrome)
        Object.defineProperty(globalThis, 'chrome', storedChrome);
      else Reflect.deleteProperty(globalThis, 'chrome');
    });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        storage: {
          local: { get: async () => ({}), set: async () => undefined },
        },
        tabs: {
          query: async () => [
            {
              id: 1,
              active: true,
              url: `https://flow.google.com/project/${projectId}`,
            },
          ],
        },
        scripting: {
          executeScript: async (injection: { args: unknown[] }) => {
            const request = injection.args[0] as FlowRpcRequest;
            if (!request.rpcId) return [{ result: [mediaId] }];
            rpcIds.push(request.rpcId);
            if (request.rpcId === 'Zzl0ze')
              return [{ result: { ok: true, payload: [] } }];
            if (scenario.code === 'flow_unusual_activity')
              return [
                {
                  result: {
                    ok: false,
                    code: scenario.code,
                    message: 'O Flow bloqueou a atividade.',
                    sent: scenario.sent,
                  },
                },
              ];
            const details: unknown[] = Array(9).fill(null);
            details[8] =
              request.rpcId === 'eb1hJf'
                ? [6]
                : [4, [null, 'PUBLIC_ERROR_UNSAFE_GENERATION']];
            return [
              {
                result: {
                  ok: true,
                  payload: [
                    null,
                    50,
                    [
                      [
                        workflowId,
                        projectId,
                        'video-media',
                        null,
                        null,
                        details,
                        null,
                        [[]],
                      ],
                    ],
                  ],
                },
              },
            ];
          },
        },
      },
    });
    const command = flowExecuteSchema.parse({
      type: 'flow-execute',
      taskId: randomUUID(),
      attemptId: randomUUID(),
      attemptNumber: 1,
      original: {
        copy: 'original copy',
        imagePrompt: 'original image',
        videoPrompt: 'original video',
      },
      sourceImage: { taskId: randomUUID(), mediaId },
      flow: {
        projectId,
        imageModel: 'GEM_PIX_2',
        videoModel: 'abra_i2v_8s',
        aspect: '9:16',
        seed: 1,
        imageSourceTaskKey: randomUUID(),
        reference: {
          assetId: randomUUID(),
          name: 'product.png',
          mime: 'image/png',
          bytes: 100,
          sha256: 'a'.repeat(64),
        },
        approval: {
          approvedAt: Date.now(),
          imageGenerations: 0,
          videoGenerations: 1,
        },
      },
    });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    new QueueExecutor().run(command, {
      readyState: WebSocket.OPEN,
      send: (message: string) =>
        messages.push(JSON.parse(message) as (typeof messages)[number]),
    } as unknown as WebSocket);
    for (
      let tick = 0;
      tick < 20 && !messages.some((m) => m.state === scenario.state);
      tick++
    ) {
      await setImmediate();
      t.mock.timers.tick(5000);
    }
    const failure = messages.find((m) => m.state === scenario.state);
    assert.equal(failure?.error?.code, scenario.code);
    assert.equal(failure.error.notSubmitted, !scenario.sent);
    assert.equal(failure.error.retryable, false);
    assert.equal(rpcIds.filter((id) => id === 'eb1hJf').length, 1);
    assert.equal(rpcIds.includes('as29s'), false);
    assert.equal(
      messages.some(
        (m) =>
          m.state === 'completed' ||
          (scenario.state !== 'uncertain' && m.state === 'uncertain'),
      ),
      false,
    );
  });
