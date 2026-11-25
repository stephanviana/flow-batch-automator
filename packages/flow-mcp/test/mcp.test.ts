import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

test('official MCP client discovers manual login and inspection tools without starting the browser', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'flow-browser-mcp-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const client = new Client({ name: 'flow-browser-fixture', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/main.js', import.meta.url))],
    cwd: directory,
    env: { FLOW_BROWSER_HOME: directory },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  await client.connect(transport).catch((error: unknown) => {
    throw new Error(`MCP connection failed: ${stderr}`, { cause: error });
  });
  t.after(() => client.close());
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(({ name }) => name).sort(), [
    'flow_browser_assets',
    'flow_browser_connect',
    'flow_browser_executor_status',
    'flow_browser_find_image',
    'flow_browser_login',
    'flow_browser_open_project',
    'flow_browser_pair',
    'flow_browser_pause_worker',
    'flow_browser_start_worker',
    'flow_browser_status',
  ]);
  const response = await client.callTool({
    name: 'flow_browser_status',
    arguments: {},
  });
  assert.notEqual(response.isError, true);
  assert.match(JSON.stringify(response.content), /browser-closed/);
  assert.deepEqual(await readdir(directory), []);
  const invalid = await client.callTool({
    name: 'flow_browser_open_project',
    arguments: { projectId: 'invalid' },
  });
  assert.equal(invalid.isError, true);
  const unavailable = await client.callTool({
    name: 'flow_browser_assets',
    arguments: { projectId: '11111111-1111-4111-8111-111111111111' },
  });
  assert.equal(unavailable.isError, true);
  assert.match(JSON.stringify(unavailable.content), /flow_tab_missing/);
  assert.deepEqual(await readdir(directory), []);
});
