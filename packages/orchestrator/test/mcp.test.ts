import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, management } from './support.js';
import { draft, image, publication } from './orders-support.js';
import { MaterialFiles } from '../src/orders/material-files.js';
import { OrderRepository } from '../src/orders/repository.js';
import { requireContract, type AgentApi } from '../src/agent-client/http.js';

test('agent fails before creating a draft against an old runtime contract', async () => {
  const old = (async () => {
    throw new Error('Not found (HTTP 404)');
  }) as AgentApi;
  await assert.rejects(requireContract(old), /aplicação foi atualizada/);
  const incompatible = (async () => ({
    contract: 'flow-orders/1',
  })) as unknown as AgentApi;
  await assert.rejects(requireContract(incompatible), /Contrato incompatível/);
});

test('official MCP client completes stdio checkout, material reading and publication outside the repository without dispatch', async (t) => {
  const f = await fixture(t),
    repository = new OrderRepository(f.database);
  const files = new MaterialFiles(
    f.config.materialsDirectory,
    repository.materials,
  );
  const material = await files.import(Readable.from(image), 'produto.png');
  const input = draft(material.id);
  input.products = [input.products[1]!];
  const order = repository.create(input);
  // Ephemeral HTTP bridge exercises the real local-session API, preserving its configured authority.
  const http = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request)
      chunks.push(Buffer.from(chunk as Uint8Array));
    const injected = await f.app.inject({
      method: request.method === 'POST' ? 'POST' : 'GET',
      url: request.url ?? '/',
      headers: {
        ...request.headers,
        host: '127.0.0.1:4319',
        ...(request.headers.origin ? { origin: 'http://127.0.0.1:4319' } : {}),
      },
      ...(chunks.length ? { payload: Buffer.concat(chunks) } : {}),
    });
    response.writeHead(injected.statusCode, injected.headers);
    response.end(injected.rawPayload);
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = http.address();
  assert.ok(address && typeof address !== 'string');
  const workspace = mkdtempSync(join(tmpdir(), 'flow-mcp-agent-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const headers = await management(f);
  const connector = await f.app.inject({
    url: '/manage/agent/download',
    headers,
  });
  assert.equal(connector.statusCode, 200, connector.body);
  const connectorPath = join(workspace, 'flow-batch-mcp.mjs');
  writeFileSync(connectorPath, connector.rawPayload);
  const client = new Client({ name: 'integration-fixture', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [connectorPath],
    cwd: tmpdir(),
    env: {
      FLOW_API_URL: `http://127.0.0.1:${address.port}`,
      FLOW_AGENT_WORKSPACE: workspace,
    },
    stderr: 'pipe',
  });
  await client.connect(transport);
  t.after(async () => {
    await client.close();
  });
  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === 'flow_checkout'));
  const reservation = await client.callTool({
    name: 'flow_checkout',
    arguments: { number: order.number },
  });
  assert.ok(!reservation.isError, JSON.stringify(reservation));
  const text = reservation.content?.[0];
  assert.ok(text?.type === 'text');
  const reserved = JSON.parse(text.text as string);
  assert.ok(
    reserved.context.instructions.some(
      (document: { path: string }) => document.path === 'instrucoes/seller.md',
    ),
  );
  assert.deepEqual(readFileSync(reserved.materials[0].path), image);
  const blank = reserved.preparation;
  assert.equal(reserved.leaseId, blank.leaseId);
  assert.equal(
    reserved.order.products[0].information,
    input.products[0]!.information,
  );
  assert.deepEqual(
    blank,
    JSON.parse(readFileSync(reserved.preparationFile, 'utf8')),
  );
  assert.equal(blank.products[0].variations[0].presenterImage, undefined);
  const read = await client.callTool({
    name: 'flow_read_material',
    arguments: { number: order.number, materialId: material.id },
  });
  assert.equal(read.content?.[0]?.type, 'image');
  const prepared = {
    ...(await publication(order, blank.leaseId)),
    libraryRevision: reserved.context.revision,
  };
  const publicationResult = await client.callTool({
    name: 'flow_publish',
    arguments: { number: order.number, preparation: prepared },
  });
  assert.ok(!publicationResult.isError, JSON.stringify(publicationResult));
  assert.equal(repository.get(order.id).state, 'prepared');
  assert.equal(
    f.database.prepare('SELECT COUNT(*) AS n FROM dispatch_commands').get()?.n,
    0,
  );
  const rejected = await client.callTool({
    name: 'flow_approve',
    arguments: {
      number: order.number,
      clientId: '00000000-0000-4000-8000-000000000001',
      preparationHash: repository.get(order.id).preparationHash,
      userAuthorized: false,
    },
  });
  assert.equal(rejected.isError, true);
  writeFileSync(
    join(f.config.materialsDirectory, material.sha256),
    Buffer.from('alterado'),
  );
  const tampered = await client.callTool({
    name: 'flow_read_material',
    arguments: { number: order.number, materialId: material.id },
  });
  assert.equal(tampered.isError, true);
});
