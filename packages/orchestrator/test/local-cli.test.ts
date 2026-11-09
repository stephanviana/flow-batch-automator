import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  cp,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupLocal } from '../src/local-cli/setup.js';
import {
  readInstallation,
  setupConfiguration,
} from '../src/local-cli/config.js';
import { STANDALONE_MARKER } from '../src/mcp/install-config.js';

test('setup uses external state, installs the distributed instruction edition and preserves installed data on repeat', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'flow-local-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = join(root, 'package');
  const state = join(root, 'state');
  await cp('../../instrucoes', join(packageRoot, 'instrucoes'), {
    recursive: true,
  });
  await mkdir(join(packageRoot, 'bin'), { recursive: true });
  await writeFile(
    join(packageRoot, 'bin/flow-batch-mcp.mjs'),
    STANDALONE_MARKER + '\n',
  );
  const first = await setupLocal(state, packageRoot, root, {
    extension: join(root, 'extension'),
  });
  assert.equal(first.configuration.libraryDirectory, join(state, 'biblioteca'));
  assert.equal(first.clients.length, 2);
  assert.equal(first.instructions.status, 'installed');
  const metadata = await readFile(
    join(state, 'biblioteca/instrucoes.json'),
    'utf8',
  );
  assert.match(
    await readFile(join(state, 'biblioteca/base.md'), 'utf8'),
    /# \[common\]/,
  );
  await writeFile(join(state, 'user-data'), 'preserved');
  const second = await setupLocal(state, packageRoot, root, {});
  assert.equal(second.backup, null);
  assert.ok(second.clients.every((client) => !client.changed));
  assert.equal(
    await readFile(join(state, 'biblioteca/instrucoes.json'), 'utf8'),
    metadata,
  );
  assert.equal(await readFile(join(state, 'user-data'), 'utf8'), 'preserved');
  assert.deepEqual(await readInstallation(state), first.configuration);
});

test('setup rejects unknown extension folders and validates explicit adoption of an existing project and volume', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'flow-local-refusal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const extension = join(root, 'extension');
  await mkdir(extension);
  await writeFile(join(extension, 'user-file'), 'preserved');
  await assert.rejects(
    setupLocal(join(root, 'state'), join(root, 'package'), root, {
      library: join(root, 'library'),
      extension,
    }),
    /outra instalação/,
  );
  assert.equal(
    await readFile(join(extension, 'user-file'), 'utf8'),
    'preserved',
  );
  const config = setupConfiguration(root, null, {
    library: root,
    extension,
    project: 'flow-batch-automator',
    volume: 'flow-batch-automator_sqlite_data',
  });
  assert.equal(config.project, 'flow-batch-automator');
  assert.equal(config.volume, 'flow-batch-automator_sqlite_data');
  assert.throws(() =>
    setupConfiguration(root, null, { library: root, extension, port: '80' }),
  );
  assert.throws(() =>
    setupConfiguration(root, null, {
      library: root,
      extension,
      project: '../unsafe',
    }),
  );
});

test('repeat setup remembers a single client and its custom configuration path', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'flow-client-selection-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = join(root, 'package');
  const state = join(root, 'state');
  await cp('../../instrucoes', join(packageRoot, 'instrucoes'), {
    recursive: true,
  });
  await mkdir(join(packageRoot, 'bin'), { recursive: true });
  await writeFile(
    join(packageRoot, 'bin/flow-batch-mcp.mjs'),
    STANDALONE_MARKER + '\n',
  );
  const custom = join(root, 'custom/config.toml');
  await setupLocal(state, packageRoot, root, {
    library: join(root, 'library'),
    extension: join(root, 'extension'),
    clients: 'codex',
    codexConfig: custom,
  });
  const second = await setupLocal(state, packageRoot, root, {});
  assert.equal(second.clients.length, 1);
  assert.equal(second.clients[0]!.client, 'codex');
  assert.equal(second.clients[0]!.configFile, custom);
  assert.equal(second.clients[0]!.changed, false);
  assert.equal(second.backup, null);
});

test('setup refuses state inside the npm prefix before initializing user files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'flow-prefix-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = join(root, 'package');
  for (const folder of ['state', '..state']) {
    await assert.rejects(
      setupLocal(join(packageRoot, folder), packageRoot, root, {
        library: join(root, 'library'),
        extension: join(root, 'extension'),
      }),
      /fora da pasta do pacote/,
    );
  }
});

test('an invalid distributed instruction edition cannot initialize the selected library destination', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'flow-invalid-edition-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const selected = join(root, 'Selected Library');
  await assert.rejects(
    setupLocal(join(root, 'state'), join(root, 'invalid-package'), root, {
      library: selected,
      extension: join(root, 'extension'),
    }),
    /edição distribuída/,
  );
  await assert.rejects(stat(selected), { code: 'ENOENT' });
});
