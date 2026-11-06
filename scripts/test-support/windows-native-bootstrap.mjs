import { mkdtemp, writeFile, rm, copyFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

if (process.platform !== 'win32')
  throw new Error('Windows test bootstrap requires Windows Node.');
const { values } = parseArgs({
  options: {
    test: { type: 'string' },
    artifact: { type: 'string' },
    name: { type: 'string' },
  },
});
const root = await mkdtemp(join(tmpdir(), 'flow-native-node-'));
try {
  let node = process.execPath;
  // Portable test tooling only: never replace the installed Node or change PATH.
  if (process.version !== 'v24.22.2') {
    const base = 'https://nodejs.org/dist/v24.22.2/';
    const sums = await fetch(base + 'SHASUMS256.txt');
    if (!sums.ok) throw new Error('Pinned Windows Node checksums unavailable.');
    const expected = (await sums.text())
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .find((parts) => parts[1] === 'win-x64/node.exe')?.[0];
    if (!expected || !/^[a-f0-9]{64}$/.test(expected))
      throw new Error('Pinned Windows Node checksum missing.');
    const response = await fetch(base + 'win-x64/node.exe');
    if (!response.ok)
      throw new Error('Pinned Windows Node download unavailable.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== expected)
      throw new Error('Pinned Windows Node checksum mismatch.');
    node = join(root, 'node.exe');
    await writeFile(node, bytes, { flag: 'wx' });
  }
  const npm = join(
    dirname(process.execPath),
    'node_modules/npm/bin/npm-cli.js',
  );
  const artifact = join(root, 'package.tgz');
  await copyFile(values.artifact, artifact);
  const result = spawnSync(
    node,
    [
      values.test,
      '--artifact',
      artifact,
      '--name',
      values.name,
      '--npm-cli',
      npm,
    ],
    { cwd: tmpdir(), stdio: 'inherit' },
  );
  process.exitCode = result.status ?? 1;
} finally {
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
