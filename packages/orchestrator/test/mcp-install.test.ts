import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { installMcpConnector } from '../src/mcp/install.js';
import { STANDALONE_MARKER } from '../src/mcp/install-config.js';

async function fixture(
  t: TestContext,
): Promise<{ root: string; source: string; config: string; target: string }> {
  const root = await mkdtemp(join(tmpdir(), 'flow-mcp-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'downloaded connector.mjs'),
    config = join(root, '.gemini', 'config', 'mcp_config.json');
  await writeFile(
    source,
    `${STANDALONE_MARKER}\n// synthetic installer fixture\n`,
  );
  return {
    root,
    source,
    config,
    target: join(root, '.flow-batch', 'mcp', 'flow-batch-mcp.mjs'),
  };
}

test('first install creates a standalone entry with absolute Node and workspace paths; repeat is idempotent', async (t) => {
  const { root, source, config, target } = await fixture(t);
  const first = await installMcpConnector({
    sourceFile: source,
    homeDirectory: root,
    skipCheck: true,
  });
  assert.equal(first.changed, true);
  assert.equal(first.runtime, 'skipped');
  assert.equal((await stat(first.workspace)).isDirectory(), true);
  assert.deepEqual(first.backups, []);
  assert.deepEqual(await readFile(target), await readFile(source));
  const saved = JSON.parse(await readFile(config, 'utf8'));
  assert.equal(saved.mcpServers['flow-batch'].command, process.execPath);
  assert.deepEqual(saved.mcpServers['flow-batch'].args, [target]);
  assert.equal(
    saved.mcpServers['flow-batch'].env.FLOW_AGENT_WORKSPACE,
    join(root, '.flow-batch', 'pedidos'),
  );
  const before = await stat(config),
    second = await installMcpConnector({
      sourceFile: source,
      homeDirectory: root,
      skipCheck: true,
    });
  assert.equal(second.changed, false);
  assert.deepEqual(second.backups, []);
  assert.equal((await stat(config)).mtimeMs, before.mtimeMs);
});

test('updates preserve all other servers, settings and custom Flow variables, with exact private backups', async (t) => {
  const { root, source, config, target } = await fixture(t);
  const other = {
    command: 'npx',
    args: ['example'],
    env: { PRIVATE_VALUE: 'opaque-secret' },
  };
  const original = JSON.stringify({
    title: 'custom setting',
    mcpServers: {
      agentmemory: other,
      'flow-batch': {
        command: 'wsl.exe',
        args: ['old.mjs'],
        disabledTools: ['example'],
        env: {
          FLOW_API_URL: 'http://localhost:4321',
          FLOW_AGENT_WORKSPACE: join(root, 'my workspace'),
          CUSTOM: 'preserved',
        },
      },
    },
  });
  await mkdir(dirname(config), { recursive: true });
  await writeFile(config, original);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, 'previous connector');
  const result = await installMcpConnector({
    sourceFile: source,
    homeDirectory: root,
    skipCheck: true,
  });
  const saved = JSON.parse(await readFile(config, 'utf8'));
  assert.deepEqual(saved.mcpServers.agentmemory, other);
  assert.equal(saved.title, 'custom setting');
  assert.equal(saved.mcpServers['flow-batch'].command, process.execPath);
  assert.equal(
    saved.mcpServers['flow-batch'].env.FLOW_API_URL,
    'http://localhost:4321',
  );
  assert.equal(saved.mcpServers['flow-batch'].env.CUSTOM, 'preserved');
  assert.deepEqual(saved.mcpServers['flow-batch'].disabledTools, ['example']);
  assert.equal(result.backups.length, 2);
  const backups = await Promise.all(
    result.backups.map((path) => readFile(path, 'utf8')),
  );
  assert.ok(backups.includes(original));
  assert.ok(backups.includes('previous connector'));
  assert.ok(!JSON.stringify(result).includes('opaque-secret'));
  if (process.platform !== 'win32')
    for (const path of result.backups)
      assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('a nested own entry is repaired without nesting mcpServers or modifying the other server', async (t) => {
  const { root, source, config } = await fixture(t);
  await mkdir(dirname(config), { recursive: true });
  await writeFile(
    config,
    JSON.stringify({
      mcpServers: {
        agentmemory: { command: 'existing' },
        mcpServers: { 'flow-batch': { command: 'wsl.exe' } },
      },
    }),
  );
  await installMcpConnector({
    sourceFile: source,
    homeDirectory: root,
    skipCheck: true,
  });
  const saved = JSON.parse(await readFile(config, 'utf8'));
  assert.deepEqual(Object.keys(saved.mcpServers).sort(), [
    'agentmemory',
    'flow-batch',
  ]);
  assert.equal(saved.mcpServers.agentmemory.command, 'existing');
});

test('invalid JSON, conflicting nested servers and remote endpoints are refused before any connector replacement', async (t) => {
  const { root, source, config, target } = await fixture(t);
  await mkdir(dirname(config), { recursive: true });
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, 'untouched connector');
  for (const original of [
    '{ "invalid":',
    JSON.stringify({
      mcpServers: { mcpServers: { unrelated: { command: 'other' } } },
    }),
    JSON.stringify({
      mcpServers: { 'flow-batch': { serverUrl: 'https://example.com/mcp' } },
    }),
  ]) {
    await writeFile(config, original);
    await assert.rejects(
      installMcpConnector({
        sourceFile: source,
        homeDirectory: root,
        skipCheck: true,
      }),
    );
    assert.equal(await readFile(config, 'utf8'), original);
    assert.equal(await readFile(target, 'utf8'), 'untouched connector');
  }
  await writeFile(config, '{}');
  await assert.rejects(
    installMcpConnector({
      sourceFile: source,
      homeDirectory: root,
      server: 'http://user:secret@127.0.0.1:4319',
      skipCheck: true,
    }),
    /sem credenciais/,
  );
  assert.deepEqual(await readdir(dirname(config)), ['mcp_config.json']);
});

test('symlink configuration is preserved and unbundled sources cannot be installed', async (t) => {
  const { root, source, config } = await fixture(t);
  const external = join(root, 'external.json');
  await writeFile(external, '{}');
  await mkdir(dirname(config), { recursive: true });
  await symlink(external, config);
  await assert.rejects(
    installMcpConnector({
      sourceFile: source,
      homeDirectory: root,
      skipCheck: true,
    }),
    /sem link simbólico/,
  );
  assert.equal(await readFile(external, 'utf8'), '{}');
  await writeFile(source, 'import "./relative-module.js";');
  await assert.rejects(
    installMcpConnector({
      sourceFile: source,
      homeDirectory: root,
      skipCheck: true,
    }),
    /conector independente/,
  );
});
