import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { resolveDesktopPaths } from '../src/paths.js';
import { DesktopRuntime } from '../src/runtime.js';
import { ExecutorControl, FlowBrowserService } from '@flow-batch/flow-mcp';
import { setTimeout as delay } from 'node:timers/promises';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePort) =>
    server.listen(0, '127.0.0.1', resolvePort),
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

test('desktop runtime seeds library, serves orders, pairs executor, switches profiles keeping clientId, and installs dual MCP', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'flow-desktop-runtime-'));
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  t.after(() => {
    process.env.HOME = previousHome;
    process.env.USERPROFILE = previousUserProfile;
  });
  const rootDir = join(home, '.flow-batch');
  const paths = resolveDesktopPaths({
    ...process.env,
    FLOW_DESKTOP_HOME: rootDir,
    FLOW_BROWSER_DOWNLOADS_DIR: join(home, 'Downloads'),
  });
  paths.bundledLibraryDir = resolve('..', '..', 'instrucoes');
  paths.standaloneMcpFile = resolve(
    '..',
    'orchestrator',
    'dist',
    'public',
    'flow-batch-mcp.mjs',
  );
  paths.browserMcpFile = resolve('..', 'flow-mcp', 'dist', 'main.js');

  const runtime = new DesktopRuntime(paths);
  t.mock.method(FlowBrowserService.prototype, 'connectSession', async () => ({
    phase: 'project-required',
    projectId: null,
    language: 'en',
    checkedAt: Date.now(),
    message: 'Flow sintético pronto.',
  }));
  let finishConnection = (): void => {};
  const connectionGate = new Promise<void>((resolveConnection) => {
    finishConnection = resolveConnection;
  });
  let starts = 0;
  t.mock.method(
    ExecutorControl.prototype,
    'start',
    async function (this: ExecutorControl) {
      starts++;
      await connectionGate;
      return { ...(await this.status()), connected: true };
    },
  );
  t.after(async () => {
    finishConnection();
    await runtime.stop();
    await rm(home, { recursive: true, force: true });
  });

  const initial = await runtime.start(await freePort());
  assert.equal(initial.activeProfile, 'default');
  assert.equal(existsSync(join(paths.libraryDir, 'base.md')), true);
  assert.equal((await fetch(`${initial.apiUrl}/orders`)).ok, true);
  const beforePairing = await runtime.connectBrowser();
  assert.match(beforePairing.message, /Confirme o pareamento/);
  assert.equal(starts, 0);

  const paired = await runtime.pairExecutor();
  assert.match(paired.navigateTo ?? '', /^\/connect\?request=/);
  const clientIdBefore = paired.snapshot.executor.clientId;
  assert.ok(clientIdBefore);

  const switched = await runtime.createProfile('conta-2');
  assert.equal(switched.snapshot.activeProfile, 'conta-2');
  assert.equal(switched.snapshot.executor.clientId, clientIdBefore);
  assert.deepEqual(
    switched.snapshot.profiles.map((profile) => profile.name),
    ['default', 'conta-2'],
  );

  // Confirm connection as the user would on /connect.
  const requestId = new URLSearchParams(paired.navigateTo!.split('?')[1]).get(
    'request',
  );
  const ordersPage = await fetch(`${initial.apiUrl}/orders`);
  const cookie = ordersPage.headers.get('set-cookie')!.split(';')[0]!;
  const approved = await fetch(
    `${initial.apiUrl}/manage/requests/${requestId}`,
    {
      method: 'POST',
      headers: {
        cookie,
        origin: initial.apiUrl,
        'content-type': 'application/json',
        'x-flow-management': '1',
      },
      body: JSON.stringify({ approve: true }),
    },
  );
  assert.equal(approved.status, 200);
  for (let round = 0; starts === 0 && round < 100; round++) await delay(10);
  assert.equal(starts, 1, 'approval should initiate the worker connection');
  const repeatedConnect = [runtime.connectBrowser(), runtime.connectBrowser()];
  assert.equal((await runtime.snapshot()).executorConnecting, true);
  finishConnection();
  for (const result of await Promise.all(repeatedConnect))
    assert.match(result.message, /Executor conectado/);
  assert.equal(
    starts,
    1,
    'concurrent connection requests must share a worker startup',
  );

  const afterApproval = await runtime.snapshot();
  assert.equal(afterApproval.executor.clientId, clientIdBefore);
  assert.equal(afterApproval.executor.authorized, true);
  assert.equal(afterApproval.executorConnecting, false);
  const failedStart = t.mock.method(
    ExecutorControl.prototype,
    'start',
    async () => {
      throw new Error('Falha sintética na conexão');
    },
  );
  await assert.rejects(runtime.pairExecutor(), /Falha sintética/);
  assert.match(
    (await runtime.snapshot()).executorConnectionMessage ?? '',
    /Falha sintética/,
  );
  await runtime.snapshot();
  assert.equal(
    failedStart.mock.callCount(),
    1,
    'status refresh must not retry a failed startup',
  );

  await writeFile(
    join(home, 'antigravity.json'),
    JSON.stringify({ mcpServers: { preserved: { command: 'ok' } } }),
  );
  const mcpOutcome = await runtime.installMcp('antigravity');
  assert.match(mcpOutcome.message, /flow-batch e flow-browser/);
  const antigravityConfig = JSON.parse(
    await readFile(join(home, '.gemini', 'config', 'mcp_config.json'), 'utf8'),
  ) as {
    mcpServers: Record<string, { args: string[]; env: Record<string, string> }>;
  };
  assert.ok(antigravityConfig.mcpServers['flow-batch']);
  assert.ok(antigravityConfig.mcpServers['flow-browser']);
  assert.equal(
    antigravityConfig.mcpServers['flow-browser'].args[0],
    paths.browserMcpFile,
  );
});
