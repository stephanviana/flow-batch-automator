import { resolve, join, isAbsolute } from 'node:path';
import { Buffer } from 'node:buffer';
import { parse, stringify } from 'smol-toml';

export const STANDALONE_MARKER = '// flow-batch-standalone-mcp:1';
type JsonObject = Record<string, unknown>;
export interface BrowserMcpOptions {
  entryFile: string;
  homeDirectory?: string;
  downloadsDirectory?: string;
}
export interface McpInstallOptions {
  client?: 'antigravity' | 'codex';
  codexHome?: string;
  sourceFile: string;
  homeDirectory: string;
  configFile?: string;
  installDirectory?: string;
  workspace?: string;
  server?: string;
  nodeExecutable?: string;
  runAsNode?: boolean;
  browser?: BrowserMcpOptions;
  skipCheck?: boolean;
}
export interface McpInstallPlan {
  configFile: string;
  connectorFile: string;
  browserConnectorFile?: string;
  workspace: string;
  server: string;
  contents: Buffer;
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
function parseConfig(original: Buffer | null, codex: boolean): JsonObject {
  if (original === null) return {};
  try {
    return object(
      codex
        ? parse(original.toString('utf8'), { integersAsBigInt: true })
        : (JSON.parse(
            original.toString('utf8').replace(/^\uFEFF/, ''),
          ) as unknown),
      'raiz',
    );
  } catch {
    throw new Error(
      `A configuração MCP contém ${codex ? 'TOML' : 'JSON'} inválido. O arquivo original foi preservado.`,
    );
  }
}
function namedServer(servers: JsonObject, name: string): JsonObject {
  if (name === 'flow-batch' && servers.mcpServers !== undefined) {
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
    servers[name] === undefined ? {} : object(servers[name], name);
  if (existing.url !== undefined || existing.serverUrl !== undefined)
    throw new Error(
      `${name} já é uma conexão remota. Use --config com outro arquivo para instalar o conector local.`,
    );
  return existing;
}
function serverEnv(previous: JsonObject, label: string): JsonObject {
  const env = previous.env === undefined ? {} : object(previous.env, label);
  if (Object.values(env).some((value) => typeof value !== 'string'))
    throw new Error('As variáveis de ambiente do MCP devem ser textos.');
  return env;
}
function nextNodeEnv(
  existing: JsonObject,
  updates: Record<string, string>,
  runAsNode?: boolean,
): Record<string, unknown> {
  const env: Record<string, unknown> = { ...existing, ...updates };
  if (runAsNode === true) env.ELECTRON_RUN_AS_NODE = '1';
  else if (runAsNode === false) delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
export function installPlan(
  options: McpInstallOptions,
  original: Buffer | null,
): McpInstallPlan {
  const codex = options.client === 'codex';
  const config = parseConfig(original, codex);
  const serialize = (): string =>
    codex
      ? stringify(config, { numbersAsFloat: true })
      : JSON.stringify(config, null, 2) + '\n';
  const before = serialize();
  const serverKey = codex ? 'mcp_servers' : 'mcpServers';
  const servers =
    config[serverKey] === undefined ? {} : object(config[serverKey], serverKey);
  const previous = namedServer(servers, 'flow-batch');
  const env = serverEnv(previous, 'flow-batch.env');
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
    env: nextNodeEnv(
      env,
      { FLOW_API_URL: server, FLOW_AGENT_WORKSPACE: workspace },
      options.runAsNode,
    ),
  };
  let browserConnectorFile: string | undefined;
  if (options.browser) {
    browserConnectorFile = resolve(options.browser.entryFile);
    if (!isAbsolute(browserConnectorFile))
      throw new Error('O conector flow-browser deve usar um caminho absoluto.');
    const previousBrowser = namedServer(servers, 'flow-browser');
    const browserEnv = serverEnv(previousBrowser, 'flow-browser.env');
    const browserHome = resolve(
      options.browser.homeDirectory ??
        (typeof browserEnv.FLOW_BROWSER_HOME === 'string'
          ? browserEnv.FLOW_BROWSER_HOME
          : join(options.homeDirectory, '.flow-batch', 'flow-browser')),
    );
    const downloadsDir = options.browser.downloadsDirectory
      ? resolve(options.browser.downloadsDirectory)
      : undefined;
    servers['flow-browser'] = {
      ...previousBrowser,
      command: executable,
      args: [browserConnectorFile],
      env: nextNodeEnv(
        browserEnv,
        {
          FLOW_API_URL: server,
          FLOW_BROWSER_HOME: browserHome,
          ...(downloadsDir ? { FLOW_BROWSER_DOWNLOADS_DIR: downloadsDir } : {}),
        },
        options.runAsNode,
      ),
    };
  }
  config[serverKey] = servers;
  return {
    configFile: resolve(options.configFile ?? defaultConfigFile(options)),
    connectorFile,
    ...(browserConnectorFile ? { browserConnectorFile } : {}),
    workspace,
    server,
    contents:
      before === serialize() && original ? original : Buffer.from(serialize()),
  };
}
export function defaultConfigFile(options: McpInstallOptions): string {
  return options.client === 'codex'
    ? join(
        options.codexHome ?? join(options.homeDirectory, '.codex'),
        'config.toml',
      )
    : join(options.homeDirectory, '.gemini', 'config', 'mcp_config.json');
}
export function configBytes(plan: McpInstallPlan): Buffer {
  return plan.contents;
}
