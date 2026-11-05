import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { localClient, requireContract } from '../agent-client/http.js';
import {
  atomicReplace,
  backupFile,
  ensureDirectory,
  regularFile,
  rollbackConnector,
  unchanged,
} from './install-files.js';
import {
  configBytes,
  defaultConfigFile,
  installPlan,
  STANDALONE_MARKER,
  type McpInstallOptions,
} from './install-config.js';

export interface McpInstallResult {
  client: 'antigravity' | 'codex';
  configFile: string;
  connectorFile: string;
  workspace: string;
  server: string;
  changed: boolean;
  backups: string[];
  runtime: 'available' | 'unavailable' | 'skipped';
  runtimeMessage: string;
  nextStep: string;
}
async function runtimeCheck(
  server: string,
  skip = false,
): Promise<Pick<McpInstallResult, 'runtime' | 'runtimeMessage'>> {
  if (skip)
    return {
      runtime: 'skipped',
      runtimeMessage: 'Consulta ao servidor dispensada.',
    };
  try {
    const api = await localClient(server, 5000);
    await requireContract(api);
    return {
      runtime: 'available',
      runtimeMessage: 'Servidor local acessível e contrato compatível.',
    };
  } catch {
    return {
      runtime: 'unavailable',
      runtimeMessage:
        'Configuração instalada. Inicie ou atualize o servidor local antes de preparar pedidos.',
    };
  }
}
export async function installMcpConnector(
  options: McpInstallOptions,
): Promise<McpInstallResult> {
  const source = await regularFile(resolve(options.sourceFile));
  if (
    !source
      ?.toString('utf8', 0, STANDALONE_MARKER.length)
      .startsWith(STANDALONE_MARKER)
  )
    throw new Error(
      'Use o conector independente gerado pelo build: pnpm mcp:install, ou node flow-batch-mcp.mjs --install antigravity.',
    );
  const configFile = resolve(options.configFile ?? defaultConfigFile(options));
  const originalConfig = await regularFile(configFile),
    plan = installPlan(options, originalConfig);
  const originalConnector = await regularFile(plan.connectorFile),
    nextConfig = configBytes(plan);
  const configChanged =
    originalConfig === null || !originalConfig.equals(nextConfig);
  const connectorChanged =
    originalConnector === null || !originalConnector.equals(source);
  const backups: string[] = [];
  await ensureDirectory(plan.workspace);
  await unchanged(configFile, originalConfig);
  await unchanged(plan.connectorFile, originalConnector);
  if (configChanged) {
    const backup = await backupFile(configFile, originalConfig);
    if (backup) backups.push(backup);
  }
  if (connectorChanged) {
    const backup = await backupFile(plan.connectorFile, originalConnector);
    if (backup) backups.push(backup);
  }
  if (connectorChanged)
    await atomicReplace(plan.connectorFile, source, originalConnector);
  try {
    if (configChanged)
      await atomicReplace(configFile, nextConfig, originalConfig);
  } catch (error) {
    if (connectorChanged)
      await rollbackConnector(plan.connectorFile, source, originalConnector);
    throw error;
  }
  return {
    client: options.client ?? 'antigravity',
    configFile,
    connectorFile: plan.connectorFile,
    workspace: plan.workspace,
    server: plan.server,
    changed: configChanged || connectorChanged,
    backups,
    ...(await runtimeCheck(plan.server, options.skipCheck)),
    nextStep:
      options.client === 'codex'
        ? 'Reabra o Codex para carregar o MCP atualizado.'
        : 'Recarregue os servidores em /mcp no Antigravity ou reabra o cliente.',
  };
}
export async function runMcpInstaller(
  args: string[],
  sourceFile: string,
  defaults: Partial<McpInstallOptions> = {},
): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      directory: { type: 'string' },
      workspace: { type: 'string' },
      server: { type: 'string' },
      'skip-check': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      'Uso: node flow-batch-mcp.mjs --install [antigravity|codex] [--config ARQUIVO] [--directory PASTA] [--workspace PASTA] [--server URL] [--skip-check]',
    );
    return;
  }
  if (
    positionals.length > 1 ||
    (positionals[0] && !['antigravity', 'codex'].includes(positionals[0]))
  )
    throw new Error('A instalação automática suporta Antigravity e Codex.');
  const result = await installMcpConnector({
    ...defaults,
    sourceFile,
    homeDirectory: homedir(),
    client: positionals[0] === 'codex' ? 'codex' : 'antigravity',
    ...(process.env.CODEX_HOME ? { codexHome: process.env.CODEX_HOME } : {}),
    ...(values.config ? { configFile: values.config } : {}),
    ...(values.directory ? { installDirectory: values.directory } : {}),
    ...(values.workspace ? { workspace: values.workspace } : {}),
    ...(values.server ? { server: values.server } : {}),
    skipCheck: values['skip-check'],
  });
  console.log(JSON.stringify(result, null, 2));
}
