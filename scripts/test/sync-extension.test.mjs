import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { syncExtension } from '../sync-extension.mjs';

async function fixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'flow-sync-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source');
  const destination = join(directory, 'destination');
  await mkdir(source);
  await mkdir(destination);
  await writeFile(
    join(source, '.flow-batch-foundation.json'),
    JSON.stringify({ project: 'flow-batch-automator', build: 'fixture' }),
  );
  await writeFile(join(source, 'manifest.json'), '{"version":"0.1.0"}');
  return { directory, source, destination };
}

test('sync copies a first build and refreshes managed files on subsequent starts', async (context) => {
  const { source, destination } = await fixture(context);
  await syncExtension(source, destination);
  await writeFile(join(source, 'manifest.json'), '{"version":"0.1.1"}');
  await syncExtension(source, destination);
  assert.equal(
    await readFile(join(destination, 'manifest.json'), 'utf8'),
    '{"version":"0.1.1"}',
  );
});

test('sync refuses a previous installation and preserves its files', async (context) => {
  const { source, destination } = await fixture(context);
  await writeFile(join(destination, 'manifest.json'), 'previous-installation');
  await assert.rejects(
    syncExtension(source, destination),
    /existing installation/,
  );
  assert.equal(
    await readFile(join(destination, 'manifest.json'), 'utf8'),
    'previous-installation',
  );
});

test('sync refuses symlink targets rather than writing outside its destination', async (context) => {
  const { directory, source, destination } = await fixture(context);
  await syncExtension(source, destination);
  const external = join(directory, 'external-file');
  await writeFile(external, 'untouched');
  await rm(join(destination, 'manifest.json'));
  await symlink(external, join(destination, 'manifest.json'));
  await assert.rejects(syncExtension(source, destination), /non-regular/);
  assert.equal(await readFile(external, 'utf8'), 'untouched');
});
