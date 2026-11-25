import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { flowRpcPage } from '../src/flow-rpc-page.js';
import type { FlowRpcRequest } from '../src/flow-rpc-contract.js';

function installGlobals(
  t: TestContext,
  overrides: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries({
    location: {
      origin: 'https://flow.google.com',
      pathname: '/project/project-fixture',
    },
    document: { documentElement: { lang: 'pt-BR' } },
    WIZ_global_data: { SNlM0e: 'fixture' },
    ...overrides,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
}

function generationRequest(
  rpcId: 'maseQ' | 'ogiZ0b' | 'eb1hJf' = 'eb1hJf',
): FlowRpcRequest {
  const context: unknown[] = Array(11).fill(null);
  context[1] = 22;
  context[10] = [null, 1];
  const entry: unknown[] = Array(8).fill(null);
  entry[7] = structuredClone(context);
  return {
    rpcId,
    projectId: 'project-fixture',
    captchaAction: rpcId === 'eb1hJf' ? 'VIDEO_GENERATION' : 'IMAGE_GENERATION',
    payload:
      rpcId === 'maseQ'
        ? [context]
        : rpcId === 'ogiZ0b'
          ? [null, [entry], 1, context]
          : [[], context],
  };
}

test('verification uses the current page API and a fresh token for each upload, image and video request', async (t) => {
  let executions = 0;
  const enterprise = {
    execute: async function (
      this: unknown,
      siteKey: string,
      options: { action: string },
    ): Promise<string> {
      assert.equal(this, enterprise);
      assert.equal(siteKey, 'fixture-site-key');
      return `fixture-${options.action}-${++executions}`;
    },
  };
  const legacy = {
    get pristine(): never {
      return assert.fail('Must not use a captured verification function');
    },
  };
  const tokens = new Set<string>();
  installGlobals(t, {
    grecaptcha: { enterprise },
    ___grecaptcha_cfg: {
      clients: { fixture: { sitekey: 'fixture-site-key' } },
    },
    __fk_hijack: legacy,
    fetch: async (_url: string, init: RequestInit): Promise<Response> => {
      assert.ok(init.body instanceof URLSearchParams);
      const envelope = JSON.parse(init.body.get('f.req') ?? '') as string[][][];
      const rpcId = envelope[0]?.[0]?.[0];
      const payload = JSON.parse(envelope[0]?.[0]?.[1] ?? '') as unknown[][];
      const context =
        payload[rpcId === 'maseQ' ? 0 : rpcId === 'ogiZ0b' ? 3 : 1];
      const token = (context?.[10] as string[])[0];
      assert.ok(token);
      assert.equal(tokens.has(token), false);
      tokens.add(token);
      if (rpcId === 'ogiZ0b') {
        const entry = payload[1]?.[0] as unknown[];
        assert.deepEqual((entry[7] as unknown[])[10], [token, 1]);
      }
      return new Response(JSON.stringify([['wrb.fr', rpcId, '[]']]));
    },
  });
  const descriptor = Object.getOwnPropertyDescriptor(enterprise, 'execute');
  for (const rpcId of ['maseQ', 'ogiZ0b', 'eb1hJf'] as const)
    assert.deepEqual(await flowRpcPage(generationRequest(rpcId)), {
      ok: true,
      payload: [],
    });
  assert.equal(executions, 3);
  assert.equal(tokens.size, 3);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(enterprise, 'execute'),
    descriptor,
  );
});

test('a page protection stops before verification or submission even if a captured function exists', async (t) => {
  let executed = false;
  installGlobals(t, {
    grecaptcha: {
      enterprise: {
        execute: async (): Promise<string> => {
          executed = true;
          return 'extension_hijack_detected';
        },
      },
    },
    __fk_hijack: {
      pristine: async () => assert.fail('Must not bypass protection'),
    },
    fetch: async () => assert.fail('Must not send a blocked request'),
  });
  const reply = await flowRpcPage(generationRequest());
  assert.equal(reply.ok, false);
  if (!reply.ok) {
    assert.equal(reply.code, 'flow_unusual_activity');
    assert.equal(reply.sent, false);
    assert.match(reply.message, /Nenhuma chamada foi enviada nesta etapa/);
  }
  assert.equal(executed, false);
});

test('missing verification does not send a request', async (t) => {
  installGlobals(t, {
    grecaptcha: undefined,
    fetch: async () => assert.fail('Must not send without verification'),
  });
  const reply = await flowRpcPage(generationRequest());
  assert.equal(reply.ok, false);
  if (!reply.ok) {
    assert.equal(reply.code, 'flow_captcha_not_ready');
    assert.equal(reply.sent, false);
  }
});

test('server unusual activity preserves submission uncertainty and hides response details', async (t) => {
  let submissions = 0;
  installGlobals(t, {
    grecaptcha: { enterprise: { execute: async () => 'fixture-token' } },
    fetch: async (): Promise<Response> => {
      submissions++;
      return new Response(
        JSON.stringify([
          [
            'wrb.fr',
            'eb1hJf',
            null,
            null,
            null,
            [7, 'PUBLIC_ERROR_UNUSUAL_ACTIVITY private-detail'],
          ],
        ]),
      );
    },
  });
  const reply = await flowRpcPage(generationRequest());
  assert.equal(reply.ok, false);
  if (!reply.ok) {
    assert.equal(reply.code, 'flow_unusual_activity');
    assert.equal(reply.sent, true);
    assert.match(
      reply.message,
      /Recusa confirmada na operação de geração de vídeo \(HTTP 200/,
    );
    assert.equal(reply.message.includes('private-detail'), false);
  }
  assert.equal(submissions, 1);
});

test('activity in another RPC is reported as unconfirmed and still stops the take', async (t) => {
  installGlobals(t, {
    grecaptcha: { enterprise: { execute: async () => 'fixture-token' } },
    fetch: async () =>
      new Response(
        JSON.stringify([
          [
            'wrb.fr',
            'other',
            null,
            null,
            null,
            [7, 'PUBLIC_ERROR_UNUSUAL_ACTIVITY'],
          ],
          ['wrb.fr', 'ogiZ0b', '[]'],
        ]),
      ),
  });
  const reply = await flowRpcPage(generationRequest('ogiZ0b'));
  assert.equal(reply.ok, false);
  if (!reply.ok) {
    assert.equal(reply.sent, true);
    assert.equal(reply.code, 'flow_unusual_activity');
    assert.match(
      reply.message,
      /sem vínculo confirmado com a operação de geração de imagem/,
    );
  }
});
