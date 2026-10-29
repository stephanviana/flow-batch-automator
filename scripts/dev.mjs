import { spawn, spawnSync } from 'node:child_process';

const workspace = new URL('../packages/orchestrator/', import.meta.url);
const initialBuild = spawnSync('pnpm', ['build'], {
  cwd: workspace,
  stdio: 'inherit',
});
if (initialBuild.status !== 0) process.exit(initialBuild.status ?? 1);
const compiler = spawn(
  'pnpm',
  [
    'exec',
    'tsc',
    '-p',
    'tsconfig.build.json',
    '--watch',
    '--preserveWatchOutput',
  ],
  { cwd: workspace, stdio: 'inherit' },
);
const server = spawn(
  process.execPath,
  ['--watch', 'packages/orchestrator/dist/main.js'],
  { cwd: new URL('../', import.meta.url), stdio: 'inherit' },
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  compiler.kill('SIGTERM');
  server.kill('SIGTERM');
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
compiler.once('exit', (code) => {
  if (!stopping) {
    process.exitCode = code ?? 1;
    stop();
  }
});
server.once('exit', (code) => {
  if (!stopping) {
    process.exitCode = code ?? 1;
    stop();
  }
});
