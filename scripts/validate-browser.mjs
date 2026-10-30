import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { validateQueue } from './browser-queue.mjs';
import { validateFlow } from './browser-flow.mjs';
import { validateFlowTake } from './browser-flow-take.mjs';
import { startMediaFixture } from './browser-media.mjs';

const directory = resolve('.cache', `browser-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const log = createWriteStream(resolve(directory, 'server.log'));
let server;
let browser;
let popup;
let management;
let extensionId;
let media;

async function eventually(check, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(200);
  }
  throw new Error('Browser condition timed out');
}
async function startServer() {
  server = spawn(process.execPath, ['packages/orchestrator/dist/main.js'], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '4319',
      DATABASE_PATH: resolve(directory, 'state.sqlite'),
      LOG_LEVEL: 'silent',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.pipe(log, { end: false });
  server.stderr.pipe(log, { end: false });
  await eventually(async () => {
    if (server.exitCode !== null)
      throw new Error(
        'Isolated server could not start; ensure port 4319 is free',
      );
    try {
      return (await fetch('http://127.0.0.1:4319/health')).ok;
    } catch {
      return false;
    }
  });
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const stopped = new Promise((resolve) => server.once('exit', resolve));
  server.kill('SIGTERM');
  await stopped;
}
async function openBrowser() {
  browser = await chromium.launchPersistentContext(
    resolve(directory, 'profile'),
    {
      channel: 'chromium',
      headless: true,
      viewport: { width: 380, height: 1000 },
      downloadsPath: resolve(directory, 'downloads'),
      args: [
        ...media.args,
        `--disable-extensions-except=${resolve('packages/extension/dist')}`,
        `--load-extension=${resolve('packages/extension/dist')}`,
      ],
    },
  );
  browser.setDefaultTimeout(15000);
  let [worker] = browser.serviceWorkers();
  worker ??= await browser.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  popup = await browser.newPage();
  const downloadSession = await browser.newCDPSession(popup);
  await downloadSession.send('Browser.setDownloadBehavior', {
    behavior: 'default',
    eventsEnabled: true,
  });
  await downloadSession.detach();
  await popup.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await popup.locator('#connection-options summary').click();
  await popup.locator('#diagnostics summary').click();
}
async function assertNonExportableIdentity() {
  const worker = browser.serviceWorkers()[0];
  const result = await worker.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('flow-batch-identity', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = reject;
    });
    const keys = await new Promise((resolve, reject) => {
      const transaction = database.transaction('keys', 'readonly');
      const request = transaction.objectStore('keys').get('identity');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = reject;
    });
    database.close();
    let rejected = false;
    try {
      await crypto.subtle.exportKey('jwk', keys.privateKey);
    } catch {
      rejected = true;
    }
    const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
    return {
      extractable: keys.privateKey.extractable,
      rejected,
      x: publicKey.x,
      y: publicKey.y,
    };
  });
  assert.equal(result.extractable, false);
  assert.equal(result.rejected, true);
  return `${result.x}.${result.y}`;
}
async function statusContains(text) {
  return (await popup.locator('#status').textContent()).includes(text);
}
async function connect() {
  const pageOpened = browser.waitForEvent('page');
  await popup
    .getByRole('button', { name: 'Conectar ao Flow Batch', exact: true })
    .click();
  management = await pageOpened;
  await management.waitForLoadState();
  await eventually(async () =>
    (await popup.locator('#code').textContent()).includes('Código:'),
  );
  const code = (await popup.locator('#code').textContent()).replace(
    'Código: ',
    '',
  );
  assert.equal(await management.locator('.code').textContent(), code);
  assert.equal(await statusContains('Conectada e autenticada'), false);
  await management.getByRole('button', { name: 'Confirmar conexão' }).click();
  await eventually(() => statusContains('Conectada e autenticada'));
}

try {
  try {
    await fetch('http://127.0.0.1:4319/health', {
      signal: AbortSignal.timeout(500),
    });
    throw new Error(
      'Port 4319 is already in use. Stop the local orchestrator before running browser validation.',
    );
  } catch (error) {
    if (
      !String(error).includes('fetch failed') &&
      !String(error).includes('Timeout')
    )
      throw error;
  }
  media = await startMediaFixture(directory);
  await mkdir(resolve(directory, 'profile/Default'), { recursive: true });
  await mkdir(resolve(directory, 'downloads'), { recursive: true });
  await writeFile(
    resolve(directory, 'profile/Default/Preferences'),
    JSON.stringify({
      download: {
        default_directory: resolve(directory, 'downloads'),
        prompt_for_download: false,
      },
    }),
  );
  await startServer();
  await openBrowser();
  await connect();
  const identity = await assertNonExportableIdentity();
  if (
    !process.argv.includes('--queue-only') &&
    !process.argv.includes('--flow-only')
  ) {
    await popup
      .getByRole('button', { name: 'Enviar teste simulado (5 s)' })
      .click();
    await eventually(async () =>
      (await popup.locator('#history').textContent()).includes('Concluída'),
    );
    // A heartbeat must keep the real MV3 worker and authenticated socket alive.
    const heartbeatWorker = browser.serviceWorkers()[0];
    await popup.close();
    popup = undefined;
    await delay(42000);
    assert.equal(await heartbeatWorker.evaluate(() => true), true);
    popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await popup.locator('#connection-options summary').click();
    await popup.locator('#diagnostics summary').click();
    await eventually(() => statusContains('Conectada e autenticada'));
    assert.equal(await statusContains('Conectada e autenticada'), true);

    await popup
      .getByRole('button', { name: 'Enviar teste simulado (5 s)' })
      .click();
    await eventually(async () =>
      (await popup.locator('#history').textContent()).includes('Em execução'),
    );
    await stopServer();
    await startServer();
    await eventually(() => statusContains('Conectada e autenticada'), 40000);
    await eventually(async () =>
      (await popup.locator('#history').textContent()).includes('Interrompida'),
    );
    assert.equal(await popup.locator('#history li').count(), 2);

    // Close the entire isolated browser and reopen the same test profile.
    await browser.close();
    browser = undefined;
    await openBrowser();
    await eventually(() => statusContains('Conectada e autenticada'), 40000);
    assert.equal(await assertNonExportableIdentity(), identity);
    assert.equal(await popup.locator('#history li').count(), 2);
    management = await browser.newPage();
    await management.goto('http://127.0.0.1:4319/connect');
    await management.getByRole('button', { name: 'Revogar acesso' }).click();
    await eventually(() => statusContains('Acesso revogado'));
    await popup
      .getByRole('button', { name: 'Reconectar', exact: true })
      .click();
    await eventually(() => statusContains('confirme uma nova autorização'));
    assert.equal(
      await popup.locator('[data-action="simulate"]').isDisabled(),
      true,
    );
    const state = await browser
      .serviceWorkers()[0]
      .evaluate(
        async () => (await chrome.storage.local.get('connection')).connection,
      );
    assert.equal(state.enabled, false);
    assert.equal(state.revoked, true);
    await connect();
    assert.equal(await assertNonExportableIdentity(), identity);
  }
  await validateFlow({ browser, panel: popup, eventually });
  if (!process.argv.includes('--flow-only'))
    await validateQueue({ popup, eventually, stopServer, startServer });
  await validateFlowTake({
    browser,
    panel: popup,
    eventually,
    stopServer,
    startServer,
    media,
  });
  await management.goto('http://127.0.0.1:4319/connect');
  console.log(
    process.argv.includes('--flow-only')
      ? 'Real Chrome for Testing: pairing, side panel, Flow transport and executor validated against local fixtures.'
      : process.argv.includes('--queue-only')
        ? 'Real Chrome for Testing: pairing, non-exportable identity and queue flow passed.'
        : 'Real Chrome for Testing: matching codes, explicit confirmation, non-exportable persistent identity, simulation, heartbeat, server/browser restart, no resend, revocation, explicit reauthorization and queue flow passed.',
  );
  console.log(`Isolated evidence: ${directory}`);
  await popup.screenshot({
    path: resolve(directory, 'sidepanel.png'),
    fullPage: true,
  });
  await management.screenshot({ path: resolve(directory, 'connect.png') });
} catch (error) {
  if (popup)
    await popup
      .screenshot({ path: resolve(directory, 'failure.png') })
      .catch(() => {});
  console.error(`Browser validation failed. Evidence: ${directory}`);
  throw error;
} finally {
  if (browser) await browser.close();
  await stopServer();
  if (media) await media.close();
  log.end();
}
