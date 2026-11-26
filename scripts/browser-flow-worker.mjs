import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { installInstructions } from './test-support/instruction-package.mjs';
import { prepareWorkerOrder } from './browser-flow-worker-order.mjs';
import { createApp } from '../packages/orchestrator/dist/app.js';
import { loadConfig } from '../packages/orchestrator/dist/config.js';
import { ExecutorApi } from '../packages/flow-mcp/.cache/test/src/executor/api.js';
import {
  PROJECT,
  PNG,
  MP4,
  generationHtml,
  envelope,
} from '../packages/flow-mcp/.cache/test/browser/generation-fixture.js';

const home = await mkdtemp(join(tmpdir(), 'flow-worker-e2e-'));
const base = 'http://127.0.0.1:4398';
installInstructions(join(home, 'library'));
const app = createApp(
  loadConfig({
    HOST: '127.0.0.1',
    PORT: '4398',
    LOG_LEVEL: 'silent',
    DATABASE_PATH: join(home, 'app.sqlite'),
    LIBRARY_DIR: join(home, 'library'),
  }),
);
let context;
let worker;
let workerError = '';
async function eventually(check, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (worker && worker.exitCode !== null)
      throw new Error(`Worker exited: ${workerError}`);
    if (await check()) return;
    await delay(100);
  }
  throw new Error('Native worker fixture timed out');
}
async function stopWorker() {
  if (!worker || worker.exitCode !== null) return;
  const ended = once(worker, 'exit');
  worker.kill('SIGTERM');
  await ended;
  worker = undefined;
}
try {
  await app.listen({ host: '127.0.0.1', port: 4398 });
  context = await chromium.launchPersistentContext(
    join(home, 'chrome-profile'),
    {
      headless: true,
      args: ['--remote-debugging-port=0'],
    },
  );
  await context.route('https://flow.google.com/**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill(
      url.pathname.endsWith('/batchexecute')
        ? {
            contentType: 'application/json',
            body: envelope(url.searchParams.get('rpcids')),
          }
        : { contentType: 'text/html', body: generationHtml() },
    );
  });
  await context.route('https://flow-content.google/**', (route) =>
    route.fulfill({
      contentType: 'video/mp4',
      body: MP4,
      headers: {
        'Access-Control-Allow-Origin': 'https://flow.google.com',
        'Access-Control-Allow-Credentials': 'true',
      },
    }),
  );
  const page = context.pages()[0];
  await page.goto(`https://flow.google.com/project/${PROJECT}`);
  const api = await ExecutorApi.open(home, base);
  const receipt = await api.pair();
  await assert.rejects(api.call('GET', '/api/identity'));
  const connect = await context.newPage();
  await connect.goto(`${base}/connect?request=${receipt.requestId}`);
  assert.equal(await connect.locator('.code').textContent(), receipt.code);
  await connect
    .getByRole('button', { name: 'Confirmar conexão', exact: true })
    .click();
  await eventually(
    async () => (await api.call('GET', '/api/identity')).authorized,
  );
  const prepared = await prepareWorkerOrder(
    context,
    base,
    home,
    PNG,
    eventually,
  );
  worker = spawn(
    process.execPath,
    [resolve('packages/flow-mcp/.cache/test/src/main.js'), '--worker'],
    {
      env: {
        ...process.env,
        FLOW_BROWSER_HOME: home,
        FLOW_API_URL: base,
        FLOW_BROWSER_DOWNLOADS_DIR: join(home, 'output'),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  worker.stderr.on('data', (chunk) => {
    workerError += chunk.toString();
  });
  await eventually(
    async () => (await api.call('GET', '/api/identity')).connected,
  );
  await prepared.api('/manage/executor/control', {
    action: 'pause',
    clientId: api.clientId,
  });
  await prepared.api(`/manage/orders/${prepared.order.id}/approve`, {
    approve: true,
    clientId: api.clientId,
  });
  const fixtureBatch = randomUUID();
  await api.call('POST', '/api/batches', {
    action: 'prepare',
    draft: { id: fixtureBatch, name: 'Pause fixture', mode: 'new-project' },
  });
  const pausedClaim = await api.call('POST', '/api/batches', {
    action: 'claim',
    id: fixtureBatch,
    expectedRevision: 0,
  });
  assert.equal(pausedClaim.attemptId, undefined);
  assert.equal(pausedClaim.batch.status, 'draft');
  assert.equal(
    (await api.call('POST', '/api/queue/control', { action: 'start' })).running,
    false,
  );
  assert.equal((await api.call('GET', '/api/dispatch')).commands.length, 0);
  assert.equal((await api.call('GET', '/api/queue')).tasks.length, 0);
  assert.equal(
    (await prepared.api('/manage/executor')).executor.pendingDispatches,
    1,
  );
  const monitorPath = `/manage/orders/${prepared.order.id}/monitor`;
  const pausedSnapshot = await prepared.api(monitorPath);
  assert.equal(pausedSnapshot.status, 'paused');
  assert.equal(pausedSnapshot.expectedDownloads, 3);
  assert.deepEqual(pausedSnapshot.confirmedDownloads, []);
  await prepared.api('/manage/executor/control', {
    action: 'start',
    clientId: api.clientId,
  });
  assert.equal((await prepared.api(monitorPath)).status, 'in_progress');
  let queue;
  await eventually(async () => {
    queue = await api.call('GET', '/api/queue');
    if (
      queue.tasks.some((task) => ['failed', 'uncertain'].includes(task.state))
    )
      throw new Error(JSON.stringify(queue));
    const dispatch = (await api.call('GET', '/api/dispatch')).commands[0];
    if (dispatch?.state === 'blocked')
      throw new Error(JSON.stringify(dispatch));
    return (
      queue.tasks.length === 3 &&
      queue.tasks.every((task) => task.state === 'completed')
    );
  }, 65000);
  const details = [];
  for (const task of queue.tasks) {
    assert.equal(task.result.simulated, false);
    assert.equal(typeof task.result.downloadId, 'string');
    const detail = await api.call('POST', '/api/queue/task', {
      taskId: task.id,
    });
    details.push(detail);
    assert.equal(detail.checkpoints.length, task.take === '01-Gancho' ? 5 : 4);
    assert.deepEqual(
      detail.input.original,
      prepared.manifest.tasks.find((expected) => expected.take === task.take)
        .original,
    );
    assert.equal(detail.input.flow.seed, null);
    assert.equal(detail.input.flow.driver, 'browser-ui');
    assert.deepEqual(
      await readFile(join(home, 'output', task.result.outputFile)),
      MP4,
    );
  }
  details.sort((left, right) => left.task.take.localeCompare(right.task.take));
  for (let index = 1; index < details.length; index++)
    assert.ok(
      details[index].attempts[0].startedAt -
        details[index - 1].attempts[0].finishedAt >=
        15000,
    );
  assert.deepEqual(await page.evaluate(() => globalThis.counts), {
    images: 1,
    videos: 3,
  });
  assert.equal(
    (await prepared.api('/manage/orders/1')).order.state,
    'completed',
  );
  const dispatch = (await api.call('GET', '/api/dispatch')).commands[0];
  const complete = await prepared.api(monitorPath);
  assert.equal(complete.status, 'completed');
  assert.equal(complete.expectedDownloads, 3);
  assert.deepEqual(
    complete.confirmedDownloads.map(({ outputFile }) => outputFile).sort(),
    queue.tasks.map(({ result }) => result.outputFile).sort(),
  );
  assert.equal(dispatch.state, 'queued');
  const ended = once(worker, 'exit');
  await prepared.api(`/manage/clients/${api.clientId}/revoke`, {});
  await ended;
  worker = undefined;
  await assert.rejects(api.call('GET', '/api/identity'));
  assert.equal(
    (await prepared.api('/manage/status')).clients[0].connected,
    false,
  );
  assert.equal(
    (await prepared.api('/manage/orders/1')).order.state,
    'completed',
  );
  assert.deepEqual(await page.evaluate(() => globalThis.counts), {
    images: 1,
    videos: 3,
  });
  console.log(
    'Native worker E2E: explicit /connect approval, panel order, checkout, monitoring during pause and resume, authorized dispatch, project creation, signed API/WebSocket v9, shared image, 15s cooldown, three Chrome-confirmed MP4s reported by monitoring, and revocation without replay passed with synthetic Flow responses.',
  );
} finally {
  await stopWorker();
  await context?.close();
  await app.close();
  await rm(home, { recursive: true, force: true });
}
