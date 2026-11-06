import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  stat,
} from 'node:fs/promises';
import { join, dirname, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { consolidatedDocument } from '../../packages/orchestrator/src/library/routing.ts';
import { nativeAddress } from '../../packages/orchestrator/src/local-cli/native-state.ts';
import { requestNativeControl } from '../../packages/orchestrator/src/local-cli/native-control.ts';
import { instructionFiles } from './instruction-package.mjs';

const { values } = parseArgs({
  options: {
    artifact: { type: 'string' },
    name: { type: 'string' },
    'npm-cli': { type: 'string' },
  },
});
const root = await mkdtemp(join(tmpdir(), 'flow-native-package-'));
const home = join(root, 'home');
const state = join(home, '.flow-batch');
const prefix = join(root, 'prefix');
const packageRoot = join(
  prefix,
  process.platform === 'win32' ? 'node_modules' : 'lib/node_modules',
  values.name,
);
const binary = join(packageRoot, 'bin/flow-batch.mjs');
const extension = join(root, 'Extensão & $ com espaços');
const environment = {
  ...Object.fromEntries(
    [
      'PATH',
      'Path',
      'PATHEXT',
      'SystemRoot',
      'SYSTEMROOT',
      'ComSpec',
      'WINDIR',
      'TEMP',
      'TMP',
      'LANG',
    ]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  ),
  PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`,
  HOME: home,
  USERPROFILE: home,
  CODEX_HOME: join(home, '.codex'),
  APPDATA: join(home, 'AppData/Roaming'),
  LOCALAPPDATA: join(home, 'AppData/Local'),
  FLOW_BATCH_HOME: state,
  MISE_SKIP_RESHIM: '1',
  npm_config_userconfig: join(root, 'empty.npmrc'),
  npm_config_cache: join(root, 'npm-cache'),
};
let client,
  running = false;
function command(executable, args, env = environment) {
  return execFileSync(executable, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 4_194_304,
  });
}
function cli(...args) {
  return command(process.execPath, [binary, ...args]);
}
function windowsShim(args) {
  const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
  const powershell = join(
    process.env.SystemRoot ?? process.env.SYSTEMROOT,
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  return command(powershell, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '& ' + [join(prefix, 'flow-batch.cmd'), ...args].map(literal).join(' '),
  ]);
}
function install(offline = false) {
  const args = [
    'install',
    '--global',
    '--prefix',
    prefix,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--registry=https://registry.npmjs.org/',
    ...(offline ? ['--offline'] : []),
    values.artifact,
  ];
  return values['npm-cli']
    ? command(process.execPath, [values['npm-cli'], ...args])
    : command('npm', args);
}
async function unusedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
try {
  await mkdir(home, { recursive: true });
  await mkdir(join(root, 'empty-path'));
  await writeFile(environment.npm_config_userconfig, '');
  install();
  if (process.platform === 'win32') {
    assert.ok((await stat(join(prefix, 'flow-batch.cmd'))).isFile());
    assert.match(windowsShim(['--help']), /Windows/);
  }
  assert.match(cli('--help'), /Windows/);
  if (process.platform === 'win32')
    windowsShim(['setup', '--extension', extension]);
  else cli('setup', '--extension', extension, '--runtime', 'native');
  const file = join(state, 'installation.json');
  const config = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(config.runtime, 'native');
  assert.equal(config.extensionDirectory, extension);
  config.port = await unusedPort();
  await writeFile(file, JSON.stringify(config, null, 2) + '\n');
  cli('setup');
  const document = consolidatedDocument(instructionFiles());
  const portable = join(root, 'biblioteca.md');
  await writeFile(portable, document);
  cli('library', 'import', portable);
  cli('library', 'validate');
  const configured = await readFile(file, 'utf8');
  const antigravity = JSON.parse(
    await readFile(join(home, '.gemini/config/mcp_config.json'), 'utf8'),
  );
  const mcp = antigravity.mcpServers['flow-batch'];
  assert.equal(mcp.command, process.execPath);
  assert.ok(!mcp.args[0].startsWith(prefix));
  assert.match(
    await readFile(join(home, '.codex/config.toml'), 'utf8'),
    /mcp_servers.flow-batch/,
  );
  // After installation, no command may depend on docker, npm, or a shell in PATH.
  environment.PATH = join(root, 'empty-path');
  delete environment.Path;
  const occupied = createServer();
  await new Promise((resolve) =>
    occupied.listen(config.port, '127.0.0.1', resolve),
  );
  assert.throws(() => cli('up'));
  await new Promise((resolve) => occupied.close(resolve));
  await assert.rejects(stat(join(config.dataDirectory, 'flow-batch.sqlite')), {
    code: 'ENOENT',
  });
  cli('up');
  running = true;
  const first = JSON.parse(cli('status'));
  assert.equal(first.state, 'running');
  cli('up');
  assert.equal(JSON.parse(cli('status')).pid, first.pid);
  cli('doctor');
  cli('setup');
  assert.equal(await readFile(file, 'utf8'), configured);
  assert.throws(() => cli('setup', '--data', join(root, 'other-data')));
  assert.throws(() =>
    command(process.execPath, [
      join(packageRoot, 'dist/native-server.mjs'),
      '--state',
      state,
      '--package',
      packageRoot,
    ]),
  );
  assert.equal(JSON.parse(cli('status')).pid, first.pid);
  const record = JSON.parse(await readFile(join(state, 'native.json'), 'utf8'));
  await assert.rejects(
    requestNativeControl(
      nativeAddress(config.dataDirectory),
      { ...record, secret: '0'.repeat(64) },
      'stop',
    ),
  );
  assert.equal(JSON.parse(cli('status')).state, 'running');
  const base = `http://127.0.0.1:${config.port}`;
  const page = await fetch(base + '/orders');
  assert.equal(page.status, 200);
  const cookie = page.headers.get('set-cookie').split(';')[0];
  await page.text();
  const headers = { cookie, origin: base, 'x-flow-management': '1' };
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  const imported = await fetch(base + '/manage/materials', {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/octet-stream',
      'x-flow-filename': 'fixture.png',
    },
    body: image,
  });
  assert.equal(imported.status, 200);
  const material = await imported.json();
  const orderResponse = await fetch(base + '/manage/orders', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      id: randomUUID(),
      name: 'Native fixture',
      products: [
        {
          id: randomUUID(),
          name: 'Fixture product',
          information: 'Synthetic information',
          materials: [material.id],
          referenceId: material.id,
          groups: [{ id: randomUUID(), format: 'seller', count: 1 }],
        },
      ],
    }),
  });
  assert.equal(orderResponse.status, 200);
  const order = await orderResponse.json();
  client = new Client({ name: 'native-package-test', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: mcp.command,
      args: mcp.args,
      cwd: root,
      env: { ...environment, ...mcp.env },
      stderr: 'pipe',
    }),
  );
  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === 'flow_publish'));
  const reservation = await client.callTool({
    name: 'flow_checkout',
    arguments: { number: order.number },
  });
  assert.ok(!reservation.isError, JSON.stringify(reservation));
  const reserved = JSON.parse(reservation.content[0].text);
  assert.deepEqual(await readFile(reserved.materials[0].path), image);
  const preparation = reserved.preparation;
  for (const product of preparation.products)
    for (const variation of product.variations) {
      variation.hookImage = {
        prompt: 'Synthetic product image',
        negative_prompt: 'Synthetic exclusions',
        aspect_ratio: '9:16',
      };
      variation.copy = {
        hook: 'Synthetic opening.',
        body: 'Synthetic details.',
        cta: 'Synthetic ending.',
      };
    }
  const published = await client.callTool({
    name: 'flow_publish',
    arguments: { number: order.number, preparation, execute: false },
  });
  assert.ok(!published.isError, JSON.stringify(published));
  assert.equal(JSON.parse(published.content[0].text).state, 'prepared');
  await client.close();
  client = undefined;
  assert.ok(!cli('logs').includes(record.secret));
  assert.ok(!cli('status').includes(record.secret));
  cli('down');
  running = false;
  assert.equal(JSON.parse(cli('status')).state, 'stopped');
  cli('down');
  const database = new DatabaseSync(
    join(config.dataDirectory, 'flow-batch.sqlite'),
  );
  assert.equal(
    database.prepare('PRAGMA integrity_check').get().integrity_check,
    'ok',
  );
  assert.equal(
    database.prepare('SELECT COUNT(*) AS n FROM dispatch_commands').get().n,
    0,
  );
  database.close();
  const runtimePath = environment.PATH;
  environment.PATH = process.env.PATH ?? process.env.Path;
  install(true);
  environment.PATH = runtimePath;
  assert.equal(
    await readFile(join(config.libraryDirectory, 'biblioteca.md'), 'utf8'),
    document,
  );
  cli('up');
  running = true;
  const second = JSON.parse(cli('status'));
  assert.notEqual(second.instanceId, first.instanceId);
  assert.equal((await fetch(base + '/health')).status, 200);
  const reconnect = await fetch(base + '/orders');
  const nextCookie = reconnect.headers.get('set-cookie').split(';')[0];
  await reconnect.text();
  const saved = await fetch(base + `/manage/orders/${order.number}`, {
    headers: { ...headers, cookie: nextCookie },
  });
  assert.equal((await saved.json()).order.state, 'prepared');
  const bytes = await fetch(base + `/manage/materials/${material.id}`, {
    headers: { ...headers, cookie: nextCookie },
  });
  assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), image);
  console.log(
    `Native npm validated on ${process.platform} Node ${process.version}: no Docker/PATH tools, both MCP configs, stdio preparation, port conflict, exclusive control, clean shutdown, SQLite integrity, reinstall and persistent materials. No paid generation.`,
  );
} finally {
  await client?.close();
  if (running) cli('down');
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
