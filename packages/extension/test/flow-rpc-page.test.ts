import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flowRpcPage as transport } from '../src/flow-rpc-page.js';
import type { FlowRpcRequest, FlowRpcReply } from '../src/flow-rpc-contract.js';
import { readFlowPayload } from '../src/flow-rpc-read.js';

async function flowRpcPage(request: FlowRpcRequest): Promise<FlowRpcReply> {
  const response = await transport(request);
  return response.ok ? readFlowPayload(request, response.payload) : response;
}

test('project lookup excludes the source image associated with the video operation', async (t) => {
  const operationId = 'operation-fixture';
  const record = (kind: string, id: string): unknown[] => [
    operationId,
    'folder',
    null,
    [
      kind === 'Video' ? 'Nome livre do anúncio' : 'Imagem de origem',
      null,
      kind === 'Video',
      null,
      id,
      operationId,
    ],
  ];
  const globals = {
    location: {
      origin: 'https://flow.google.com',
      pathname: '/project/project-fixture',
    },
    document: { documentElement: { lang: 'pt-BR' } },
    WIZ_global_data: { SNlM0e: 'fixture' },
    fetch: async (): Promise<Response> =>
      new Response(
        JSON.stringify([
          [
            'wrb.fr',
            'Zzl0ze',
            JSON.stringify([
              record('Image', 'source-image'),
              record('Video', 'generated-video'),
            ]),
          ],
        ]),
      ),
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const result = await flowRpcPage({
    rpcId: 'Zzl0ze',
    projectId: 'project-fixture',
    operationId,
    sourceMediaId: 'source-image',
    payload: ['projects/project-fixture'],
  });
  assert.deepEqual(result, {
    ok: true,
    value: { mediaId: 'generated-video', sourceFound: true },
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (): Promise<Response> =>
      new Response(
        JSON.stringify([
          [
            'wrb.fr',
            'as29s',
            JSON.stringify([
              'https://flow-content.google/video/rendered-file?fixture=1',
            ]),
          ],
        ]),
      ),
  });
  assert.deepEqual(
    await flowRpcPage({
      rpcId: 'as29s',
      projectId: 'project-fixture',
      mediaId: 'generated-video',
      payload: ['generated-video'],
    }),
    {
      ok: true,
      value: {
        mediaId: 'generated-video',
        videoUrl: 'https://flow-content.google/video/rendered-file?fixture=1',
      },
    },
  );
});

test('operation complaints are reported without exposing arbitrary response text or claiming failure', async (t) => {
  const detail: unknown[] = Array(9).fill(null);
  detail[8] = [4, [null, 'Media not found.'], ['private response content']];
  const globals = {
    location: {
      origin: 'https://flow.google.com',
      pathname: '/project/project-fixture',
    },
    document: { documentElement: { lang: 'pt-BR' } },
    WIZ_global_data: { SNlM0e: 'fixture' },
    fetch: async (): Promise<Response> =>
      new Response(
        JSON.stringify([
          [
            'wrb.fr',
            'jwpduf',
            JSON.stringify([
              null,
              50,
              [
                [
                  'OPERATION-fixture',
                  'project-fixture',
                  'scene',
                  'BUSY',
                  null,
                  detail,
                ],
              ],
            ]),
          ],
        ]),
      ),
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const reply = await flowRpcPage({
    rpcId: 'jwpduf',
    projectId: 'project-fixture',
    operationId: 'operation-fixture',
    payload: [null, null, [['operation-fixture']]],
  });
  assert.deepEqual(reply, {
    ok: true,
    value: {
      operationId: 'OPERATION-fixture',
      mediaId: 'scene',
      status: 'BUSY',
      outcomeCode: 4,
      complaint: 'media_not_found',
    },
  });
  assert.equal(
    JSON.stringify(reply).includes('private response content'),
    false,
  );
});

test('a result lookup returning code 5 identifies a missing operation', async (t) => {
  for (const [key, value] of Object.entries({
    location: {
      origin: 'https://flow.google.com',
      pathname: '/project/project-fixture',
    },
    document: { documentElement: { lang: 'pt-BR' } },
    WIZ_global_data: { SNlM0e: 'fixture' },
    fetch: async () =>
      new Response(
        JSON.stringify([['wrb.fr', 'as29s', null, null, null, [5]]]),
      ),
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const reply = await flowRpcPage({
    rpcId: 'as29s',
    projectId: 'project-fixture',
    payload: ['operation'],
  });
  assert.equal(reply.ok, false);
  if (!reply.ok) {
    assert.equal(reply.code, 'flow_operation_not_found');
    assert.match(reply.message, /não encontrou a operação/);
  }
});
