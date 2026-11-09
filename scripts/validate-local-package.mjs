import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { releaseMetadata } from './npm/manifest.mjs';
import { auditPackage } from './npm/audit.mjs';
import { consolidatedDocument } from '../packages/orchestrator/dist/library/routing.js';
import { instructionFiles } from './test-support/instruction-package.mjs';

const require = createRequire(
  new URL('../packages/orchestrator/package.json', import.meta.url),
);
const { Client } = await import(
  pathToFileURL(require.resolve('@modelcontextprotocol/client')).href
);
const { StdioClientTransport } = await import(
  pathToFileURL(require.resolve('@modelcontextprotocol/client/stdio')).href
);
const release = await releaseMetadata();
const artifact = release.artifact;
await auditPackage(artifact, release);
const root = await mkdtemp(join(tmpdir(), 'flow-npm-package-'));
const prefix = join(root, 'prefix');
const home = join(root, 'home');
const state = join(home, '.flow-batch $HOME');
const packageRoot = join(prefix, 'lib/node_modules', release.name);
const environment = {
  ...process.env,
  PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
  HOME: home,
  MISE_SKIP_RESHIM: '1',
  CODEX_HOME: join(home, '.codex'),
  FLOW_BATCH_HOME: state,
  FLOW_LOCAL_PACKAGE_DIRECTORY: packageRoot,
  FLOW_LOCAL_EXTENSION_DIRECTORY: join(root, 'extension with spaces'),
  FLOW_LOCAL_LIBRARY_DIRECTORY: join(state, 'biblioteca'),
  npm_config_userconfig: '/dev/null',
  npm_config_cache: join(root, 'npm-cache'),
};
const binary = join(prefix, 'bin/flow-batch');
const docker = process.argv.includes('--docker');
const npm = process.env.FLOW_TEST_NPM ?? 'npm';
const project = `flow-package-test-${process.pid}`;
let started = false;
function execute(command, args, env = environment) {
  return execFileSync(command, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 4 * 1024 * 1024,
  });
}
function cli(...args) {
  return execute(binary, args);
}
async function discovery(command, args) {
  const client = new Client({
    name: 'npm-package-validation',
    version: '1.0.0',
  });
  const transport = new StdioClientTransport({
    command,
    args,
    env: environment,
    cwd: root,
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.ok(tools.some((tool) => tool.name === 'flow_checkout'));
    assert.ok(tools.some((tool) => tool.name === 'flow_approve'));
  } finally {
    await client.close();
  }
}
async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
try {
  await mkdir(join(home, '.gemini/config'), { recursive: true });
  await mkdir(join(home, '.codex'), { recursive: true });
  await writeFile(
    join(home, '.gemini/config/mcp_config.json'),
    JSON.stringify({ mcpServers: { other: { command: 'preserved' } } }),
  );
  await writeFile(
    join(home, '.codex/config.toml'),
    '# Custom configuration\nmodel = "preserved-model"\n[mcp_servers.other]\ncommand = "preserved"\n',
  );
  execute(npm, [
    'install',
    '--global',
    '--prefix',
    prefix,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    artifact,
  ]);
  const installed = JSON.parse(
    await readFile(join(packageRoot, 'package.json'), 'utf8'),
  );
  assert.equal(installed.name, release.name);
  assert.equal(installed.private, undefined);
  assert.deepEqual(installed.publishConfig, {
    registry: release.registry,
    access: release.access,
  });
  assert.equal(installed.scripts, undefined);
  assert.deepEqual(installed.dependencies, release.dependencies);
  assert.deepEqual((await readdir(packageRoot)).sort(), [
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'bin',
    'dist',
    'instrucoes',
    'node_modules',
    'package.json',
    'runtime',
  ]);
  const lock = JSON.parse(
    await readFile(join(packageRoot, 'runtime/package-lock.json'), 'utf8'),
  );
  assert.deepEqual(lock.packages[''].dependencies, release.dependencies);
  for (const [name, version] of Object.entries(release.dependencies)) {
    const metadata = JSON.parse(
      await readFile(
        join(packageRoot, 'node_modules', name, 'package.json'),
        'utf8',
      ),
    );
    assert.equal(metadata.version, version);
  }
  assert.ok(
    (await readFile(join(packageRoot, 'dist/main.mjs'), 'utf8')).includes(
      'fastify',
    ),
  );
  assert.ok(
    !(await readdir(join(packageRoot, 'runtime'))).includes('app.tar.gz'),
  );
  assert.match(cli('--help'), /WSL\/Linux/);
  const port = docker ? await freePort() : 4319;
  cli(
    'setup',
    '--extension',
    join(root, 'extension with spaces'),
    '--project',
    project,
  );
  const library = join(state, 'biblioteca');
  assert.match(
    await readFile(join(library, 'base.md'), 'utf8'),
    /# \[common\]/,
  );
  const portable = join(root, 'portable-library.md');
  const document = consolidatedDocument(instructionFiles());
  await writeFile(portable, document);
  cli('library', 'import', portable);
  cli('library', 'validate');
  const exported = join(root, 'exported-library.md');
  cli('library', 'export', exported);
  assert.equal(await readFile(exported, 'utf8'), document);
  if (docker) {
    // The shipped Chrome extension remains on 4319. Override only this synthetic
    // server fixture so the HTTP/MCP test never competes with a real installation.
    const file = join(state, 'installation.json');
    const synthetic = JSON.parse(await readFile(file, 'utf8'));
    synthetic.port = port;
    await writeFile(file, JSON.stringify(synthetic, null, 2) + '\n');
    cli('setup');
  }
  const antigravity = JSON.parse(
    await readFile(join(home, '.gemini/config/mcp_config.json'), 'utf8'),
  );
  assert.equal(antigravity.mcpServers.other.command, 'preserved');
  const codex = await readFile(join(home, '.codex/config.toml'), 'utf8');
  assert.match(codex, /preserved-model/);
  assert.match(codex, /mcp_servers.other/);
  assert.match(codex, /mcp_servers.flow-batch/);
  await discovery(
    antigravity.mcpServers['flow-batch'].command,
    antigravity.mcpServers['flow-batch'].args,
  );
  await discovery(binary, ['mcp']);
  const configuration = await readFile(
    join(state, 'installation.json'),
    'utf8',
  );
  cli('setup');
  assert.equal(
    await readFile(join(state, 'installation.json'), 'utf8'),
    configuration,
  );
  // A reinstall replaces only software. User files survive outside the npm prefix.
  await writeFile(join(state, 'user-data'), 'preserved');
  execute(npm, [
    'install',
    '--global',
    '--prefix',
    prefix,
    '--offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    artifact,
  ]);
  assert.equal(await readFile(join(state, 'user-data'), 'utf8'), 'preserved');
  assert.equal(
    await readFile(join(library, 'biblioteca.md'), 'utf8'),
    document,
  );
  assert.equal(
    await readFile(join(state, 'installation.json'), 'utf8'),
    configuration,
  );
  if (docker) {
    started = true;
    cli('up');
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ready');
    const html = await fetch(`http://127.0.0.1:${port}/orders`);
    assert.equal(html.status, 200);
    cli('doctor');
    cli('status');
    assert.ok(
      (await readdir(join(root, 'extension with spaces'))).includes(
        'manifest.json',
      ),
    );
    const compose = [
      'compose',
      '--env-file',
      '/dev/null',
      '-p',
      project,
      '-f',
      join(state, 'compose.json'),
    ];
    execute('docker', [
      ...compose,
      'exec',
      '-T',
      'orchestrator',
      'node',
      '--input-type=module',
      '-e',
      'import { writeFileSync } from "node:fs"; writeFileSync("/data/persistence-check", "preserved");',
    ]);
    execute('docker', [
      ...compose,
      'exec',
      '-T',
      'orchestrator',
      'node',
      '--input-type=module',
      '-e',
      'import { readFileSync } from "node:fs"; const lock = JSON.parse(readFileSync("/app/package-lock.json", "utf8")); for (const [path, dependency] of Object.entries(lock.packages)) { if (!path) continue; const installed = JSON.parse(readFileSync("/app/" + path + "/package.json", "utf8")); if (installed.version !== dependency.version) throw new Error("Production dependency differs from lockfile"); }',
    ]);
    cli('down');
    cli('up');
    assert.equal(
      execute('docker', [
        ...compose,
        'exec',
        '-T',
        'orchestrator',
        'cat',
        '/data/persistence-check',
      ]).trim(),
      'preserved',
    );
  }
  console.log(
    `npm package validated outside checkout: installation, both MCP configs, stdio discovery, repeat setup, reinstall${docker ? ', Compose startup, HTTP panel and persistent volume across down/up' : ''}. No paid generation.`,
  );
} finally {
  if (started) {
    try {
      cli('down');
    } finally {
      // This exact volume was created solely for this test; never prune other data.
      execute('docker', ['volume', 'rm', `${project}_sqlite_data`]);
    }
  }
  await rm(root, { recursive: true, force: true });
}
