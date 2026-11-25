import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';

const env = {
  ...process.env,
  PLAYWRIGHT_BROWSERS_PATH: resolve('.cache/browsers'),
};
const steps = [
  [
    'node_modules/typescript/bin/tsc',
    '-p',
    'packages/flow-mcp/tsconfig.test.json',
  ],
  [
    '--test',
    ...readdirSync('packages/flow-mcp/browser')
      .filter((name) => name.endsWith('.test.ts'))
      .map(
        (name) =>
          `packages/flow-mcp/.cache/test/browser/${name.replace(/\.ts$/, '.js')}`,
      ),
  ],
  ['scripts/browser-flow-worker.mjs'],
];
for (const args of steps) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
