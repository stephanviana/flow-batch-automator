import { readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { LibraryStore } from '../library/store.js';
import { installMcpConnector, type McpInstallResult } from '../mcp/install.js';
import { ensureDirectory, regularFile } from '../mcp/install-files.js';
import {
  readInstallation,
  saveInstallation,
  setupConfiguration,
  type Installation,
  type SetupPaths,
} from './config.js';
import { nativeStatus } from './native.js';
import { nativeDataDirectory } from './native-state.js';

export interface SetupOptions extends SetupPaths {
  clients?: string;
  codexConfig?: string;
  antigravityConfig?: string;
  codexHome?: string;
}
async function preserveRunningNative(
  root: string,
  previous: Installation | null,
  next: Installation,
): Promise<void> {
  if (previous?.runtime !== 'native') return;
  const changed =
    previous.runtime !== next.runtime ||
    previous.port !== next.port ||
    previous.libraryDirectory !== next.libraryDirectory ||
    previous.extensionDirectory !== next.extensionDirectory ||
    nativeDataDirectory(root, previous) !== nativeDataDirectory(root, next);
  if (changed && (await nativeStatus(root, previous)).state !== 'stopped')
    throw new Error(
      'Encerre e confirme o servidor com flow-batch down antes de mudar o runtime ou suas pastas. Se o controle estiver indisponível, confira status e logs.',
    );
}
async function extensionDestination(path: string): Promise<void> {
  await ensureDirectory(path);
  const entries = await readdir(path);
  if (!entries.length) return;
  const marker = await regularFile(join(path, '.flow-batch-foundation.json'));
  if (
    !marker ||
    JSON.parse(marker.toString('utf8')).project !== 'flow-batch-automator'
  )
    throw new Error(
      'A pasta da extensão contém arquivos de outra instalação. Escolha uma pasta vazia ou uma extensão Flow Batch identificada.',
    );
}
function clientConfiguration(
  previous: Installation | null,
  homeDirectory: string,
  options: SetupOptions,
): NonNullable<Installation['mcp']> {
  const selected = (
    options.clients ??
    previous?.mcp?.clients.join(',') ??
    'antigravity,codex'
  ).split(',');
  if (
    !selected.length ||
    selected.some((client) => !['antigravity', 'codex'].includes(client))
  )
    throw new Error('Use --clients antigravity,codex, antigravity ou codex.');
  return {
    clients: [...new Set(selected)].map((name) =>
      name === 'codex' ? 'codex' : 'antigravity',
    ),
    codexConfig: resolve(
      options.codexConfig ??
        previous?.mcp?.codexConfig ??
        join(options.codexHome ?? join(homeDirectory, '.codex'), 'config.toml'),
    ),
    antigravityConfig: resolve(
      options.antigravityConfig ??
        previous?.mcp?.antigravityConfig ??
        join(homeDirectory, '.gemini/config/mcp_config.json'),
    ),
  };
}
function externalState(
  root: string,
  config: Installation,
  packageRoot: string,
): void {
  for (const directory of [
    root,
    config.libraryDirectory,
    config.extensionDirectory,
    config.workspace,
    ...(config.dataDirectory ? [config.dataDirectory] : []),
  ]) {
    const path = relative(packageRoot, directory);
    if (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
      throw new Error(
        'Guarde configuração, biblioteca, extensão e pedidos fora da pasta do pacote npm.',
      );
  }
}
async function registerClients(
  root: string,
  packageRoot: string,
  homeDirectory: string,
  config: Installation,
): Promise<McpInstallResult[]> {
  const clients: McpInstallResult[] = [];
  for (const client of config.mcp!.clients) {
    const configFile =
      client === 'codex'
        ? config.mcp!.codexConfig
        : config.mcp!.antigravityConfig;
    clients.push(
      await installMcpConnector({
        sourceFile: join(packageRoot, 'bin', 'flow-batch-mcp.mjs'),
        homeDirectory,
        client,
        installDirectory: join(root, 'mcp'),
        workspace: config.workspace,
        server: `http://127.0.0.1:${config.port}`,
        skipCheck: true,
        configFile,
      }),
    );
  }
  return clients;
}
export async function setupLocal(
  root: string,
  packageRoot: string,
  homeDirectory: string,
  options: SetupOptions,
): Promise<{
  configuration: Installation;
  clients: McpInstallResult[];
  backup: string | null;
}> {
  const previous = await readInstallation(root);
  const config = setupConfiguration(root, previous, options);
  await preserveRunningNative(root, previous, config);
  config.mcp = clientConfiguration(previous, homeDirectory, options);
  externalState(root, config, packageRoot);
  await extensionDestination(config.extensionDirectory);
  await ensureDirectory(config.libraryDirectory);
  await ensureDirectory(config.workspace);
  if (config.runtime === 'native' && config.dataDirectory)
    await ensureDirectory(config.dataDirectory);
  new LibraryStore(config.libraryDirectory);
  const backup = await saveInstallation(root, config);
  const clients = await registerClients(
    root,
    packageRoot,
    homeDirectory,
    config,
  );
  return { configuration: config, clients, backup };
}
