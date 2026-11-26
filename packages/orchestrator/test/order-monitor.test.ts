import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import type { AgentApi } from '../src/agent-client/http.js';
import { registerOrderMonitor } from '../src/mcp/order-monitor.js';

test('monitor follows the same order UUID after polling by number', async (t) => {
  const id = randomUUID();
  const calls: string[] = [];
  const api = (async (path: string): Promise<unknown> => {
    calls.push(path);
    return {
      orderId: id,
      status: calls.length === 1 ? 'in_progress' : 'completed',
    };
  }) as AgentApi;
  const server = new McpServer({ name: 'monitor-fixture', version: '1.0.0' });
  registerOrderMonitor(server, api);
  const client = new Client({ name: 'monitor-client', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const reply = await client.callTool({
    name: 'flow_wait_order',
    arguments: { order: 1, waitSeconds: 1 },
  });
  assert.equal(reply.isError, undefined, JSON.stringify(reply));
  assert.match(JSON.stringify(reply.content), /completed/);
  assert.deepEqual(calls, [
    '/manage/orders/1/monitor',
    `/manage/orders/${id}/monitor`,
  ]);
});

test('monitor reports stops and expired polling windows without mutations or retrying generation', async (t) => {
  const id = randomUUID();
  let status = 'in_progress';
  const calls: { path: string; body: unknown }[] = [];
  const api = (async (path: string, body?: unknown): Promise<unknown> => {
    calls.push({ path, body });
    return { orderId: id, status };
  }) as AgentApi;
  const server = new McpServer({ name: 'monitor-stops', version: '1.0.0' });
  registerOrderMonitor(server, api);
  const client = new Client({ name: 'monitor-stops-client', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  for (status of [
    'in_progress',
    'completed',
    'paused',
    'needs_review',
    'executor_disconnected',
    'cancelled',
    'not_dispatched',
  ]) {
    calls.length = 0;
    const reply = await client.callTool({
      name: 'flow_wait_order',
      arguments: { order: id, waitSeconds: status === 'in_progress' ? 0 : 35 },
    });
    assert.equal(reply.isError, undefined, JSON.stringify(reply));
    assert.deepEqual(reply.content, [
      { type: 'text', text: JSON.stringify({ orderId: id, status }, null, 2) },
    ]);
    assert.deepEqual(calls, [
      { path: `/manage/orders/${id}/monitor`, body: undefined },
    ]);
  }
});
