import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { runMcpInstaller } from '../mcp/install.js';
import {
  readInstallation,
  requireInstallation,
  type Installation,
} from './config.js';
import { composeCommand } from './compose.js';
import { runProcess } from './process.js';
import { diagnose } from './doctor.js';
import { setupLocal } from './setup.js';
import { startNative, stopNative, nativeStatus, nativeLogs } from './native.js';

const setupArguments = {
  library: { type: 'string' },
  extension: { type: 'string' },
  workspace: { type: 'string' },
  clients: { type: 'string' },
  project: { type: 'string' },
  volume: { type: 'string' },
  runtime: { type: 'string' },
  data: { type: 'string' },
  'codex-config': { type: 'string' },
  'antigravity-config': { type: 'string' },
} as const;
async function runSetup(
  args: string[],
  root: string,
  packageRoot: string,
): Promise<void> {
  const { values } = parseArgs({ args, options: setupArguments });
  const result = await setupLocal(root, packageRoot, homedir(), {
    ...values,
    ...(values['codex-config'] ? { codexConfig: values['codex-config'] } : {}),
    ...(values['antigravity-config']
      ? { antigravityConfig: values['antigravity-config'] }
      : {}),
    ...(process.env.CODEX_HOME ? { codexHome: process.env.CODEX_HOME } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
  console.log(
    'Configuração salva. Execute flow-batch up e reabra os clientes MCP.',
  );
}
function runtimeEnvironment(config: Installation | null): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(config
      ? {
          FLOW_API_URL: `http://127.0.0.1:${config.port}`,
          FLOW_AGENT_WORKSPACE: config.workspace,
        }
      : {}),
  };
}
async function runMcp(
  args: string[],
  root: string,
  packageRoot: string,
): Promise<void> {
  const connector = join(packageRoot, 'bin', 'flow-batch-mcp.mjs');
  const config = await readInstallation(root);
  if (args[0] === 'install') {
    await runMcpInstaller(args.slice(1), connector, {
      installDirectory: join(root, 'mcp'),
      ...(config
        ? {
            workspace: config.workspace,
            server: `http://127.0.0.1:${config.port}`,
          }
        : {}),
    });
    return;
  }
  if (args.length)
    throw new Error(
      'Use flow-batch mcp ou flow-batch mcp install antigravity|codex.',
    );
  process.exitCode = (
    await runProcess(
      process.execPath,
      [connector],
      false,
      runtimeEnvironment(config),
    )
  ).code;
}
async function checkExistingService(config: Installation): Promise<void> {
  const result = await runProcess(
    'docker',
    [
      'ps',
      '--filter',
      `publish=${config.port}`,
      '--format',
      '{{.ID}} {{.Label "com.docker.compose.project"}}',
    ],
    true,
  );
  if (result.code)
    throw new Error(
      'Não foi possível consultar o Docker. Verifique o daemon e as permissões no WSL.',
    );
  const owners = result.stdout.trim().split('\n').filter(Boolean);
  if (owners.some((owner) => owner.trim().split(/\s+/)[1] !== config.project))
    throw new Error(
      'Há outro serviço Docker usando esta porta. Preserve a instalação existente; confira a instalação e configure explicitamente seu --project e --volume antes de iniciar.',
    );
}
async function runService(
  command: string,
  args: string[],
  root: string,
  packageRoot: string,
): Promise<void> {
  if (args.length)
    throw new Error(`O comando ${command} não recebe argumentos.`);
  const config = await requireInstallation(root);
  if (command === 'doctor') {
    const checks = await diagnose(config, root);
    console.log(JSON.stringify(checks, null, 2));
    process.exitCode = checks.every((check) => check.ok) ? 0 : 1;
    return;
  }
  if (config.runtime === 'native') {
    if (command === 'up')
      console.log(
        JSON.stringify(await startNative(root, config, packageRoot), null, 2),
      );
    else if (command === 'down')
      console.log(JSON.stringify(await stopNative(root, config), null, 2));
    else if (command === 'status')
      console.log(JSON.stringify(await nativeStatus(root, config), null, 2));
    else if (command === 'logs') console.log(await nativeLogs(root));
    else
      throw new Error(
        `Comando desconhecido: ${command}. Use flow-batch --help.`,
      );
    if (command === 'up')
      console.log(
        `Pedidos: http://127.0.0.1:${config.port}/orders\nConexão: http://127.0.0.1:${config.port}/connect\nRecarregue a extensão no Chrome após uma atualização.`,
      );
    return;
  }
  const actions: Record<string, string[]> = {
    up: ['up', '-d', '--build', '--wait', '--wait-timeout', '60'],
    down: ['down'],
    status: ['ps', '--all'],
    logs: ['logs', '--tail', '100', 'orchestrator'],
  };
  const action = actions[command];
  if (!action)
    throw new Error(`Comando desconhecido: ${command}. Use flow-batch --help.`);
  if (command === 'up') await checkExistingService(config);
  process.exitCode = (
    await composeCommand(root, config, packageRoot, action)
  ).code;
  if (command === 'up' && !process.exitCode)
    console.log(
      `Pedidos: http://127.0.0.1:${config.port}/orders\nConexão: http://127.0.0.1:${config.port}/connect\nRecarregue a extensão no Chrome após uma atualização.`,
    );
}
export async function executeLocalCommand(
  command: string,
  args: string[],
  root: string,
  packageRoot: string,
): Promise<void> {
  if (command === 'setup') return runSetup(args, root, packageRoot);
  if (command === 'mcp') return runMcp(args, root, packageRoot);
  if (command === 'library' || command === 'orders') {
    const config =
      command === 'orders' ? await requireInstallation(root) : null;
    process.exitCode = (
      await runProcess(
        process.execPath,
        [join(packageRoot, 'bin', `${command}.mjs`), ...args],
        false,
        runtimeEnvironment(config),
      )
    ).code;
    return;
  }
  await runService(command, args, root, packageRoot);
}
