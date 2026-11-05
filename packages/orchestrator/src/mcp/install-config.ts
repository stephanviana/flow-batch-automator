import { resolve, join, isAbsolute } from 'node:path';
import { Buffer } from 'node:buffer';

export const STANDALONE_MARKER = '// flow-batch-standalone-mcp:1';
type JsonObject = Record<string, unknown>;
export interface McpInstallOptions {
  sourceFile: string;
  homeDirectory: string;
  configFile?: string;
  installDirectory?: string;
  workspace?: string;
  server?: string;
  nodeExecutable?: string;
  skipCheck?: boolean;
}
export interface McpInstallPlan {
  configFile: string;
  connectorFile: string;
  workspace: string;
  server: string;
  config: JsonObject;
}
function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(
      `Configuração inválida em ${label}. O arquivo original foi preservado.`,
    );
  return value as JsonObject;
}
export function localServer(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Informe uma URL HTTP local válida para o servidor.');
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(
      'O servidor deve usar HTTP local, sem credenciais, query ou caminho adicional.',
    );
  return url.origin;
}
function parseConfig(original: Buffer | null): JsonObject {
  if (original === null) return {};
  try {
    return object(
      JSON.parse(original.toString('utf8').replace(/^\uFEFF/, '')) as unknown,
      'raiz',
    );
  } catch {
    throw new Error(
      'A configuração MCP contém JSON inválido. O arquivo original foi preservado.',
    );
  }
}
function ownServer(servers: JsonObject): JsonObject {
  if (servers.mcpServers !== undefined) {
    const nested = object(servers.mcpServers, 'mcpServers.mcpServers');
    if (
      Object.keys(nested).length !== 1 ||
      nested['flow-batch'] === undefined ||
      servers['flow-batch'] !== undefined
    )
      throw new Error(
        'Há uma camada mcpServers adicional com entradas conflitantes. A instalação preservou o arquivo original.',
      );
    servers['flow-batch'] = nested['flow-batch'];
    delete servers.mcpServers;
  }
  const existing =
    servers['flow-batch'] === undefined
      ? {}
      : object(servers['flow-batch'], 'flow-batch');
  if (existing.url !== undefined || existing.serverUrl !== undefined)
    throw new Error(
      'flow-batch já é uma conexão remota. Use --config com outro arquivo para instalar o conector local.',
    );
  return existing;
}
export function installPlan(
  options: McpInstallOptions,
  original: Buffer | null,
): McpInstallPlan {
  const config = parseConfig(original);
  const servers =
    config.mcpServers === undefined
      ? {}
      : object(config.mcpServers, 'mcpServers');
  const previous = ownServer(servers);
  const env =
    previous.env === undefined ? {} : object(previous.env, 'flow-batch.env');
  if (Object.values(env).some((value) => typeof value !== 'string'))
    throw new Error('As variáveis de ambiente do MCP devem ser textos.');
  const workspace = resolve(
    options.workspace ??
      (typeof env.FLOW_AGENT_WORKSPACE === 'string'
        ? env.FLOW_AGENT_WORKSPACE
        : join(options.homeDirectory, '.flow-batch', 'pedidos')),
  );
  const server = localServer(
    options.server ??
      (typeof env.FLOW_API_URL === 'string'
        ? env.FLOW_API_URL
        : 'http://127.0.0.1:4319'),
  );
  const connectorFile = join(
    resolve(
      options.installDirectory ??
        join(options.homeDirectory, '.flow-batch', 'mcp'),
    ),
    'flow-batch-mcp.mjs',
  );
  const executable = options.nodeExecutable ?? process.execPath;
  if (!isAbsolute(executable))
    throw new Error('O executável Node deve usar um caminho absoluto.');
  servers['flow-batch'] = {
    ...previous,
    command: executable,
    args: [connectorFile],
    env: { ...env, FLOW_API_URL: server, FLOW_AGENT_WORKSPACE: workspace },
  };
  config.mcpServers = servers;
  return {
    configFile: resolve(
      options.configFile ??
        join(options.homeDirectory, '.gemini', 'config', 'mcp_config.json'),
    ),
    connectorFile,
    workspace,
    server,
    config,
  };
}
export function configBytes(plan: McpInstallPlan): Buffer {
  return Buffer.from(JSON.stringify(plan.config, null, 2) + '\n');
}
