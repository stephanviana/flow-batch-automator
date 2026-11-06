import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';
import { createApp } from '../packages/orchestrator/dist/app.js';
import { loadConfig } from '../packages/orchestrator/dist/config.js';
import {
  requestConnection,
  authenticateConnection,
} from './test-support/connect-client.mjs';

const directory = resolve('.cache', `browser-connect-${randomUUID()}`);
await mkdir(resolve(directory, 'library'), { recursive: true });
const config = loadConfig({
  HOST: '127.0.0.1',
  PORT: '4369',
  DATABASE_PATH: resolve(directory, 'state.sqlite'),
  LIBRARY_DIR: resolve(directory, 'library'),
  LOG_LEVEL: 'silent',
});
const base = 'http://127.0.0.1:4369';
const app = createApp(config);
const database = new DatabaseSync(config.databasePath);
let browser;
let page;
let socket;
const errors = [];
async function expectState(state) {
  await page.waitForFunction(
    (value) =>
      document.querySelector('#connection-state').dataset.state === value,
    state,
  );
}
async function capture(name) {
  for (const width of [1487, 1920, 1081, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1058 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
      true,
      `Overflow at ${width}px`,
    );
    await page.screenshot({
      path: resolve(directory, `${name}-${width}.png`),
      fullPage: true,
    });
  }
}
async function verifyEmptyAndPending() {
  await page.goto(`${base}/connect`);
  await expectState('idle');
  assert.equal(await page.locator('#pending-count').textContent(), '0');
  assert.equal(await page.locator('#clients-count').textContent(), '0');
  await page.screenshot({
    path: resolve(directory, 'empty.png'),
    fullPage: true,
  });
  const cancelled = await requestConnection(base, 'a'.repeat(32));
  const client = await requestConnection(base, 'b'.repeat(32));
  await page.goto(`${base}/connect?request=${cancelled.requestId}`);
  await page.locator('.code').waitFor();
  assert.equal(await page.locator('.code').textContent(), cancelled.code);
  assert.equal(await page.locator('#pending-count').textContent(), '1');
  assert.equal(
    database
      .prepare(
        'SELECT count(*) AS n FROM clients WHERE authorized_at IS NOT NULL',
      )
      .get().n,
    0,
  );
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page
    .getByText('Nenhuma solicitação pendente', { exact: true })
    .waitFor();
  await page.goto(`${base}/connect?request=${client.requestId}`);
  await page.locator('.code').waitFor();
  assert.equal(await page.locator('.code').textContent(), client.code);
  await capture('pending');
  await page
    .getByRole('button', { name: 'Confirmar conexão', exact: true })
    .click();
  await expectState('offline');
  assert.equal(await page.locator('#clients-count').textContent(), '1');
  return client;
}
async function verifyConnected(client) {
  socket = await authenticateConnection(base, client);
  await page.goto(`${base}/connect`);
  await expectState('connected');
  await capture('connected');
  await page.setViewportSize({ width: 1487, height: 1058 });
  const summary = page.locator('#clients .client-identity > summary');
  await summary.click();
  assert.equal(
    await page.locator('#clients code').textContent(),
    client.extensionId,
  );
  await page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/manage/status',
  );
  assert.equal(
    await page
      .locator('#clients .client-identity')
      .evaluate((node) => node.open),
    true,
  );
  await summary.click();
  const closed = once(socket, 'close');
  socket.close();
  await closed;
  socket = null;
  await expectState('offline');
  await page.getByText('Autorizada · desconectada', { exact: true }).waitFor();
  await page.screenshot({
    path: resolve(directory, 'offline.png'),
    fullPage: true,
  });
  socket = await authenticateConnection(base, client);
  await expectState('connected');
}
async function verifyRevocationAndExpiry(client) {
  const closed = once(socket, 'close');
  await page
    .getByRole('button', { name: 'Revogar acesso', exact: true })
    .click();
  await closed;
  socket = null;
  await expectState('idle');
  assert.equal(await page.locator('#clients-count').textContent(), '0');
  assert.equal(
    await page
      .getByRole('button', { name: 'Revogar acesso', exact: true })
      .count(),
    0,
  );
  await page.locator('#revoked-history > summary').click();
  await page.getByText('Acesso revogado', { exact: true }).waitFor();
  await page.screenshot({
    path: resolve(directory, 'revoked.png'),
    fullPage: true,
  });
  const expired = await requestConnection(base, 'c'.repeat(32));
  database
    .prepare('UPDATE pairing_requests SET expires_at=0 WHERE id=?')
    .run(expired.requestId);
  await page.goto(`${base}/connect?request=${expired.requestId}`);
  await expectState('idle');
  assert.equal(
    await page
      .getByRole('button', { name: 'Confirmar conexão', exact: true })
      .count(),
    0,
  );
  const renewed = await requestConnection(base, client.extensionId, client.key);
  assert.equal(renewed.clientId, client.clientId);
  assert.ok(
    database
      .prepare('SELECT revoked_at FROM clients WHERE id=?')
      .get(client.clientId).revoked_at,
  );
  await page.goto(`${base}/connect?request=${renewed.requestId}`);
  await page.locator('.code').waitFor();
  assert.equal(await page.locator('.code').textContent(), renewed.code);
  await page
    .getByRole('button', { name: 'Confirmar conexão', exact: true })
    .click();
  await expectState('offline');
  assert.equal(
    database
      .prepare('SELECT revoked_at FROM clients WHERE id=?')
      .get(client.clientId).revoked_at,
    null,
  );
}
async function verifyUnavailable() {
  await page.route('**/manage/status', (route) =>
    route.fulfill({ status: 503, json: { error: 'fixture-unavailable' } }),
  );
  await page.reload();
  await expectState('error');
  assert.equal(
    await page.locator('#connection-state').textContent(),
    'Conexão indisponível',
  );
  await page.unroute('**/manage/status');
  await expectState('offline');
  assert.equal(await page.locator('#status').textContent(), '');
}
try {
  await app.listen({ host: '127.0.0.1', port: config.port });
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  page = await browser.newPage({ viewport: { width: 1487, height: 1058 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.resourceType() === 'font')
      errors.push('Unexpected font request');
  });
  page.on('response', (response) => {
    if (
      response.status() >= 400 &&
      /\.(js|css)$/.test(new URL(response.url()).pathname)
    )
      errors.push('Asset request failed');
  });
  const client = await verifyEmptyAndPending();
  await verifyConnected(client);
  await verifyRevocationAndExpiry(client);
  await verifyUnavailable();
  assert.equal(
    database.prepare('SELECT count(*) AS n FROM dispatch_commands').get().n,
    0,
  );
  assert.equal(
    database.prepare('SELECT count(*) AS n FROM queue_tasks').get().n,
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Chrome isolado com identidade sintética e WebSocket autenticado: layout de 320 a 1920 px, códigos, filtro da solicitação, cancelamento, confirmação, ID, conexão/desconexão, revogação, expiração e nova autorização passaram. Sem fontes adicionais, despacho ou geração.',
  );
  console.log(`Evidências: ${directory}`);
} catch (error) {
  if (page)
    await page
      .screenshot({ path: resolve(directory, 'failure.png'), fullPage: true })
      .catch(() => {});
  console.error(`Evidências: ${directory}`);
  throw error;
} finally {
  if (socket) socket.terminate();
  if (browser) await browser.close();
  await app.close();
  database.close();
}
