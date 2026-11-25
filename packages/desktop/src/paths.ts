import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DesktopPaths {
  rootDir: string;
  databasePath: string;
  materialsDir: string;
  libraryDir: string;
  workspaceDir: string;
  browserHome: string;
  downloadsDir: string;
  videosDir: string;
  bundledLibraryDir: string;
  standaloneMcpFile: string;
  browserMcpFile: string;
  assetsDir: string;
  preloadFile: string;
}

function firstExisting(candidates: string[]): string {
  return (
    candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!
  );
}

export function resolveDesktopPaths(
  env: NodeJS.ProcessEnv = process.env,
  resourcesPath?: string,
): DesktopPaths {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const rootDir = resolve(
    env.FLOW_DESKTOP_HOME ?? join(homedir(), '.flow-batch'),
  );
  const downloadsDir = resolve(
    env.FLOW_BROWSER_DOWNLOADS_DIR ?? join(homedir(), 'Downloads'),
  );
  const bundledLibraryDir = firstExisting([
    ...(resourcesPath ? [join(resourcesPath, 'instrucoes')] : []),
    resolve(packageRoot, '..', '..', 'instrucoes'),
  ]);
  const standaloneMcpFile = firstExisting([
    ...(resourcesPath
      ? [join(resourcesPath, 'mcp', 'flow-batch-mcp.mjs')]
      : []),
    resolve(
      packageRoot,
      '..',
      'orchestrator',
      'dist',
      'public',
      'flow-batch-mcp.mjs',
    ),
  ]);
  const browserMcpFile = firstExisting([
    resolve(
      packageRoot,
      'node_modules',
      '@flow-batch',
      'flow-mcp',
      'dist',
      'main.js',
    ),
    resolve(packageRoot, '..', 'flow-mcp', 'dist', 'main.js'),
  ]);
  return {
    rootDir,
    databasePath: resolve(
      env.DATABASE_PATH ?? join(rootDir, 'data', 'flow-batch.sqlite'),
    ),
    materialsDir: resolve(
      env.MATERIALS_DIR ?? join(rootDir, 'data', 'materials'),
    ),
    libraryDir: resolve(
      env.FLOW_LIBRARY_DIR ?? env.LIBRARY_DIR ?? join(rootDir, 'biblioteca'),
    ),
    workspaceDir: resolve(env.FLOW_AGENT_WORKSPACE ?? join(rootDir, 'pedidos')),
    browserHome: resolve(
      env.FLOW_BROWSER_HOME ?? join(rootDir, 'flow-browser'),
    ),
    downloadsDir,
    videosDir: join(downloadsDir, 'Flow', 'Videos'),
    bundledLibraryDir,
    standaloneMcpFile,
    browserMcpFile,
    assetsDir: join(packageRoot, 'dist', 'public'),
    preloadFile: join(packageRoot, 'dist', 'preload.cjs'),
  };
}
