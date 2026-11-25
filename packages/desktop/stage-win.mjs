import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname);
const stage = join(packageRoot, '.cache', 'win-stage');

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
execFileSync(
  'pnpm',
  ['--filter', '@flow-batch/desktop', '--prod', 'deploy', stage],
  { cwd: resolve(packageRoot, '..', '..'), stdio: 'inherit' },
);
await cp(join(packageRoot, 'dist'), join(stage, 'dist'), {
  recursive: true,
});
