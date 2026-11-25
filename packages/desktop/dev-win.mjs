import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname);
const repoRoot = resolve(packageRoot, '..', '..');
const unpacked = join(packageRoot, 'release', 'win-unpacked');
const exePath = join(unpacked, 'Flow Batch.exe');
const appDir = join(unpacked, 'resources', 'app');

const rebuild = process.argv.includes('--rebuild');
const prepareOnly = process.argv.includes('--prepare-only');

if (
  process.platform !== 'linux' ||
  !existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')
)
  throw new Error(
    'desktop:dev:win deve ser executado no WSL com interop Windows habilitado. No Windows nativo, use pnpm desktop:dev.',
  );

async function ensurePortFree(port) {
  await new Promise((resolvePort, rejectPort) => {
    const probe = connect({ host: '127.0.0.1', port });
    probe.setTimeout(500);
    probe.once('connect', () => {
      probe.destroy();
      rejectPort(
        new Error(
          `A porta 127.0.0.1:${port} já está em uso (ex.: container Docker ou outra instância). Pare-a antes de iniciar ou defina PORT.`,
        ),
      );
    });
    probe.once('timeout', () => {
      probe.destroy();
      resolvePort();
    });
    probe.once('error', () => {
      probe.destroy();
      resolvePort();
    });
  });
}

function runPnpm(args, cwd = repoRoot) {
  execFileSync('pnpm', args, { cwd, stdio: 'inherit' });
}

async function syncUnpackedCode() {
  runPnpm([
    '--filter',
    '@flow-batch/protocol',
    '--filter',
    '@flow-batch/flow-mcp',
    '--filter',
    '@flow-batch/orchestrator',
    '--filter',
    '@flow-batch/desktop',
    'build',
  ]);
  for (const [source, destination] of [
    [join(packageRoot, 'dist'), join(appDir, 'dist')],
    [
      join(repoRoot, 'packages', 'protocol', 'dist'),
      join(appDir, 'node_modules', '@flow-batch', 'protocol', 'dist'),
    ],
    [
      join(repoRoot, 'packages', 'flow-mcp', 'dist'),
      join(appDir, 'node_modules', '@flow-batch', 'flow-mcp', 'dist'),
    ],
    [
      join(repoRoot, 'packages', 'orchestrator', 'dist'),
      join(appDir, 'node_modules', '@flow-batch', 'orchestrator', 'dist'),
    ],
    [join(repoRoot, 'instrucoes'), join(unpacked, 'resources', 'instrucoes')],
  ]) {
    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true });
  }
  await mkdir(join(unpacked, 'resources', 'mcp'), { recursive: true });
  await cp(
    join(
      repoRoot,
      'packages',
      'orchestrator',
      'dist',
      'public',
      'flow-batch-mcp.mjs',
    ),
    join(unpacked, 'resources', 'mcp', 'flow-batch-mcp.mjs'),
  );
}

if (rebuild || !existsSync(exePath) || !existsSync(appDir)) {
  runPnpm(['run', 'build:win:dir'], packageRoot);
} else {
  await syncUnpackedCode();
}

function windowsEnv() {
  const forwarded = [
    'PORT',
    'LOG_LEVEL',
    'FLOW_DESKTOP_HOME',
    'FLOW_LIBRARY_DIR',
    'FLOW_BROWSER_CHROME',
  ].filter((name) => process.env[name] !== undefined);
  if (!forwarded.length) return process.env;
  const existing = process.env.WSLENV ? process.env.WSLENV.split(':') : [];
  return {
    ...process.env,
    WSLENV: [...new Set([...existing, ...forwarded])].join(':'),
  };
}

if (prepareOnly) {
  console.log(`Windows dev app pronto em: ${exePath}`);
} else {
  const port = Number(process.env.PORT ?? 4319);
  await ensurePortFree(Number.isFinite(port) ? port : 4319);
  const child = spawn(exePath, [], {
    cwd: dirname(exePath),
    env: windowsEnv(),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const code = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (status) => resolveExit(status ?? 0));
  });
  process.exitCode = code;
}
