import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { installMcpConnector } from '../src/mcp/install.js';
import { STANDALONE_MARKER } from '../src/mcp/install-config.js';

test('the repository install command defaults to Antigravity and accepts the Codex argument', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'flow-mcp-script-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = JSON.parse(
    await readFile(resolve('../../package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };
  const [executable, entry, ...argumentsBeforeClient] =
    manifest.scripts['mcp:install']!.split(/\s+/);
  assert.equal(executable, 'node');
  assert.ok(entry?.endsWith('flow-batch-mcp.mjs'));
  const connector = fileURLToPath(
    new URL('../src/public/flow-batch-mcp.mjs', import.meta.url),
  );
  for (const client of ['antigravity', 'codex']) {
    const result = spawnSync(
      process.execPath,
      [
        connector,
        ...argumentsBeforeClient,
        ...(client === 'codex' ? ['codex'] : []),
        '--config',
        join(root, client === 'codex' ? 'config.toml' : 'mcp.json'),
        '--directory',
        join(root, 'connector'),
        '--workspace',
        join(root, 'workspace'),
        '--skip-check',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, HOME: root, CODEX_HOME: join(root, 'codex') },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      (JSON.parse(result.stdout) as { client: string }).client,
      client,
    );
  }
});

const original = `# Personal settings\nmodel = "my-model"\nlimit = 9007199254740993\nratio = 1.0\n[mcp_servers.other]\ncommand = "preserved"\n[mcp_servers.other.env]\nPRIVATE_VALUE = "test-placeholder"\n[mcp_servers."flow-batch"]\ncommand = "old-node"\nargs = ["old-file"]\ndisabled_tools = ["example"]\nstartup_timeout_sec = 20\n[mcp_servers."flow-batch".env]\nFLOW_API_URL = "http://localhost:4321"\nCUSTOM = "preserved"\n`;

test('Codex registration preserves unrelated settings, integers, tool policies and environment with exact backups and idempotence', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'flow-codex-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceFile = join(root, 'connector.mjs');
  const codexHome = join(root, 'custom codex home');
  const configFile = join(codexHome, 'config.toml');
  await mkdir(codexHome);
  await writeFile(sourceFile, STANDALONE_MARKER + '\n');
  await writeFile(configFile, original);
  const options = {
    sourceFile,
    homeDirectory: root,
    codexHome,
    client: 'codex' as const,
    skipCheck: true,
  };
  const first = await installMcpConnector(options);
  const saved = parse(await readFile(configFile, 'utf8'), {
    integersAsBigInt: true,
  });
  const before = parse(original, { integersAsBigInt: true });
  assert.equal(saved.model, before.model);
  assert.equal(saved.limit, 9007199254740993n);
  assert.equal(saved.ratio, before.ratio);
  const servers = saved.mcp_servers as Record<string, Record<string, unknown>>;
  assert.deepEqual(
    servers.other,
    (before.mcp_servers as Record<string, unknown>).other,
  );
  assert.deepEqual(servers['flow-batch']!.disabled_tools, ['example']);
  assert.equal(servers['flow-batch']!.startup_timeout_sec, 20n);
  assert.equal(servers['flow-batch']!.command, process.execPath);
  assert.deepEqual(
    { ...(servers['flow-batch']!.env as Record<string, unknown>) },
    {
      FLOW_API_URL: 'http://localhost:4321',
      CUSTOM: 'preserved',
      FLOW_AGENT_WORKSPACE: join(root, '.flow-batch/pedidos'),
    },
  );
  assert.equal(first.client, 'codex');
  assert.equal(first.configFile, configFile);
  assert.equal(first.backups.length, 1);
  assert.equal(await readFile(first.backups[0]!, 'utf8'), original);
  const modified = (await stat(configFile)).mtimeMs;
  const second = await installMcpConnector(options);
  assert.equal(second.changed, false);
  assert.deepEqual(second.backups, []);
  assert.equal((await stat(configFile)).mtimeMs, modified);
  assert.ok(!JSON.stringify(first).includes('test-placeholder'));
});

test('invalid TOML, remote entries and symlinks are refused before connector changes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'flow-codex-refusal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceFile = join(root, 'source.mjs');
  const configFile = join(root, '.codex/config.toml');
  const connector = join(root, '.flow-batch/mcp/flow-batch-mcp.mjs');
  await mkdir(dirname(configFile), { recursive: true });
  await mkdir(dirname(connector), { recursive: true });
  await writeFile(sourceFile, STANDALONE_MARKER + '\n');
  await writeFile(connector, 'preserved');
  const options = {
    sourceFile,
    homeDirectory: root,
    client: 'codex' as const,
    skipCheck: true,
  };
  for (const contents of [
    'broken = [',
    '[mcp_servers.flow-batch]\nurl = "https://example.com/mcp"\n',
  ]) {
    await writeFile(configFile, contents);
    await assert.rejects(installMcpConnector(options));
    assert.equal(await readFile(configFile, 'utf8'), contents);
    assert.equal(await readFile(connector, 'utf8'), 'preserved');
  }
  await rm(configFile);
  const external = join(root, 'external.toml');
  await writeFile(external, original);
  await symlink(external, configFile);
  await assert.rejects(installMcpConnector(options), /sem link simbólico/);
  assert.equal(await readFile(external, 'utf8'), original);
});
