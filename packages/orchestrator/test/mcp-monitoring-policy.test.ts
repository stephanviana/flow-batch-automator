import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { AgentApi } from '../src/agent-client/http.js';
import { createMcpServer } from '../src/mcp/server.js';

test('MCP discovery requires monitoring after execution, retries, revisions and resumption', async (t) => {
  const api = (async () => {
    throw new Error('Discovering monitoring rules must not invoke the API.');
  }) as AgentApi;
  const server = createMcpServer(api, '/unused-monitoring-workspace');
  const client = new Client({ name: 'monitoring-policy', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const instructions = client.getInstructions();
  assert.ok(instructions);
  assert.match(
    instructions,
    /imagem confirmada pelo ID com zero novas imagens/,
  );
  assert.match(instructions, /Vídeo já localizado impede nova geração/);
  const { tools } = await client.listTools();
  const entryPoints = [
    'flow_publish',
    'flow_approve',
    'flow_retry_take',
    'flow_prepare_take_revision',
    'flow_approve_take_revision',
    'flow_resume_dispatch',
    'flow_queue_control',
    'flow_wait_order',
  ];
  for (const name of entryPoints) {
    const tool = tools.find((tool) => tool.name === name);
    assert.ok(tool?.description, name);
    for (const text of [instructions, tool.description]) {
      assert.match(text, /acompanhamento é obrigatório por padrão/, name);
      assert.match(
        text,
        /Não encerre a resposta apenas porque.*enfileirado/,
        name,
      );
      assert.match(text, /enquanto status=in_progress.*orderId UUID/, name);
      assert.match(
        text,
        /O fim da janela.*não significa falha nem conclusão/,
        name,
      );
      assert.match(text, /Chrome confirmar todos os MP4s esperados/, name);
      assert.match(text, /Só dispense.*usuário pedir explicitamente/, name);
      assert.match(
        text,
        /Preparar sem executar não inicia acompanhamento/,
        name,
      );
      assert.match(text, /flow_order_diagnostics e flow_queue_status/, name);
      assert.match(text, /Preserve pausas explícitas/, name);
      assert.match(
        text,
        /Não prometa.*notificação futura sem sessão ativa/,
        name,
      );
    }
  }
  assert.equal(
    tools.find((tool) => tool.name === 'flow_wait_order')?.annotations
      ?.readOnlyHint,
    true,
  );
});
