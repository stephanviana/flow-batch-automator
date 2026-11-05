import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localClient } from '../agent-client/http.js';
import { createMcpServer } from './server.js';
import { runMcpInstaller } from './install.js';

async function startServer(): Promise<void> {
  const workspace = resolve(
    process.env.FLOW_AGENT_WORKSPACE ??
      resolve(homedir(), '.flow-batch', 'pedidos'),
  );
  // Lazy connection allows discovery while the local application is stopped.
  let client: ReturnType<typeof localClient> | undefined;
  const api = (async (
    ...args: Parameters<Awaited<ReturnType<typeof localClient>>>
  ) => {
    client ??= localClient(process.env.FLOW_API_URL).catch((error: unknown) => {
      client = undefined;
      throw error;
    });
    return (await client)(...args);
  }) as Awaited<ReturnType<typeof localClient>>;
  await createMcpServer(api, workspace).connect(new StdioServerTransport());
}
try {
  const args = process.argv.slice(2);
  if (args[0] === '--install')
    await runMcpInstaller(args.slice(1), fileURLToPath(import.meta.url));
  else if (args.length)
    throw new Error(
      'Use --install antigravity para instalar ou execute sem argumentos para iniciar o MCP.',
    );
  else await startServer();
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : 'Não foi possível iniciar o MCP local.',
  );
  process.exitCode = 1;
}
