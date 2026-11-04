import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { localClient } from '../agent-client/http.js';
import { createMcpServer } from './server.js';

const workspace = resolve(
  process.env.FLOW_AGENT_WORKSPACE ??
    resolve(homedir(), '.flow-batch', 'pedidos'),
);
// Lazy connection lets the MCP host discover tools even while the local app is stopped.
let client: ReturnType<typeof localClient> | undefined;
const api = (async (
  ...args: Parameters<Awaited<ReturnType<typeof localClient>>>
) => {
  client ??= localClient(process.env.FLOW_API_URL).catch((error: unknown) => {
    client = undefined;
    throw error;
  });
  const connected = await client;
  return connected(...args);
}) as Awaited<ReturnType<typeof localClient>>;
const server = createMcpServer(api, workspace);
try {
  await server.connect(new StdioServerTransport());
} catch {
  console.error('Não foi possível iniciar o MCP local do Flow Batch.');
  process.exitCode = 1;
}
