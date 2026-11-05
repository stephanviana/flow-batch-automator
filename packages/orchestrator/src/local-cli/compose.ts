import { join } from 'node:path';
import { atomicReplace, regularFile } from '../mcp/install-files.js';
import type { Installation } from './config.js';
import { runProcess, type CommandResult } from './process.js';

export function composeDocument(config: Installation): object {
  const hardened = {
    user: '1000:1000',
    read_only: true,
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
    pids_limit: 64,
    logging: {
      driver: 'json-file',
      options: { 'max-size': '5m', 'max-file': '2' },
    },
  };
  const bind = (source: string, target: string): object => ({
    type: 'bind',
    source,
    target,
    bind: { create_host_path: false },
  });
  const build = (target: string): object => ({
    context: '${FLOW_LOCAL_PACKAGE_DIRECTORY}',
    dockerfile: 'runtime/Dockerfile',
    target,
  });
  return {
    services: {
      'sync-extension': {
        ...hardened,
        build: build('sync-extension'),
        network_mode: 'none',
        restart: 'no',
        cpus: 0.25,
        mem_limit: '128m',
        volumes: [bind('${FLOW_LOCAL_EXTENSION_DIRECTORY}', '/destination')],
      },
      orchestrator: {
        ...hardened,
        build: build('orchestrator'),
        init: true,
        depends_on: {
          'sync-extension': { condition: 'service_completed_successfully' },
        },
        environment: {
          HOST: '0.0.0.0',
          PORT: String(config.port),
          DATABASE_PATH: '/data/flow-batch.sqlite',
          LIBRARY_DIR: '/library',
          SQLITE_BUSY_TIMEOUT_MS: '3000',
          LOG_LEVEL: 'info',
        },
        ports: [`127.0.0.1:${config.port}:${config.port}`],
        volumes: [
          'sqlite_data:/data',
          bind('${FLOW_LOCAL_LIBRARY_DIRECTORY}', '/library'),
        ],
        restart: 'unless-stopped',
        stop_grace_period: '10s',
        cpus: 0.5,
        mem_limit: '256m',
      },
    },
    volumes: { sqlite_data: { name: config.volume } },
  };
}
export async function composeCommand(
  root: string,
  config: Installation,
  packageRoot: string,
  args: string[],
  capture = false,
): Promise<CommandResult> {
  // Inject paths through environment substitutions, avoiding repeated interpolation of literal dollars.
  const file = join(root, 'compose.json');
  const contents = Buffer.from(
    JSON.stringify(composeDocument(config), null, 2) + '\n',
  );
  const original = await regularFile(file);
  if (!original?.equals(contents))
    await atomicReplace(file, contents, original);
  return runProcess(
    'docker',
    [
      'compose',
      '--env-file',
      '/dev/null',
      '--project-directory',
      root,
      '-p',
      config.project,
      '-f',
      file,
      ...args,
    ],
    capture,
    {
      ...process.env,
      COMPOSE_DISABLE_ENV_FILE: '1',
      FLOW_LOCAL_PACKAGE_DIRECTORY: packageRoot,
      FLOW_LOCAL_EXTENSION_DIRECTORY: config.extensionDirectory,
      FLOW_LOCAL_LIBRARY_DIRECTORY: config.libraryDirectory,
    },
  );
}
