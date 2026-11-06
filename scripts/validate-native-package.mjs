import { build } from 'esbuild';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { releaseMetadata } from './npm/manifest.mjs';
import { auditPackage } from './npm/audit.mjs';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

const release = await releaseMetadata();
await auditPackage(release.artifact, release);
const test = resolve(`.cache/native-package-test-${randomUUID()}.mjs`);
await build({
  entryPoints: ['scripts/test-support/native-package.mjs'],
  outfile: test,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  bundle: true,
  banner: {
    js: "import { createRequire as testRequire } from 'node:module'; const require = testRequire(import.meta.url);",
  },
  nodePaths: [resolve('packages/orchestrator/node_modules')],
  alias: { '@flow-batch/protocol': resolve('packages/protocol/src/index.ts') },
});
const args = ['--artifact', release.artifact, '--name', release.name];
try {
  if (process.argv.includes('--windows') && process.platform !== 'win32') {
    const windowsPath = (path) =>
      execFileSync('wslpath', ['-w', resolve(path)], {
        encoding: 'utf8',
      }).trim();
    const node =
      process.env.FLOW_TEST_WINDOWS_NODE ??
      '/mnt/c/Program Files/nodejs/node.exe';
    const result = spawnSync(
      node,
      [
        windowsPath('scripts/test-support/windows-native-bootstrap.mjs'),
        '--test',
        windowsPath(test),
        '--artifact',
        windowsPath(release.artifact),
        '--name',
        release.name,
      ],
      { stdio: 'inherit' },
    );
    if (result.error)
      throw new Error(
        'Não foi possível iniciar o Node Windows de teste. Confira FLOW_TEST_WINDOWS_NODE e a interoperabilidade WSL.',
      );
    process.exitCode = result.status ?? 1;
  } else {
    if (process.platform === 'win32')
      args.push(
        '--npm-cli',
        join(
          resolve(process.execPath, '..'),
          'node_modules/npm/bin/npm-cli.js',
        ),
      );
    const result = spawnSync(process.execPath, [test, ...args], {
      stdio: 'inherit',
    });
    process.exitCode = result.status ?? 1;
  }
} finally {
  await rm(test, { force: true });
}
