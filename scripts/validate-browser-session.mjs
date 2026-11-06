import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';
import { createApp } from '../packages/orchestrator/dist/app.js';
import { loadConfig } from '../packages/orchestrator/dist/config.js';
import {
  requestConnection,
  authenticateConnection,
} from './test-support/connect-client.mjs';

const directory = resolve('.cache', `browser-session-${randomUUID()}`);
await mkdir(resolve(directory, 'library'), { recursive: true });
const config = loadConfig({
  HOST: '127.0.0.1',
  PORT: '4379',
  LOG_LEVEL: 'silent',
  DATABASE_PATH: resolve(directory, 'state.sqlite'),
  LIBRARY_DIR: resolve(directory, 'library'),
});
const base = 'http://127.0.0.1:4379';
let app = createApp(config);
const database = new DatabaseSync(config.databasePath);
let browser;
let context;
let page;
let socket;
const requests = [];
const errors = [];
const count = (path, method = 'POST') =>
  requests.filter((entry) => entry.path === path && entry.method === method)
    .length;
async function api(path, body) {
  return page.evaluate(
    async ({ path, body }) =>
      (await import('/management-api.js')).api(path, body),
    { path, body },
  );
}
async function failure(path, body) {
  return page.evaluate(
    async ({ path, body }) => {
      try {
        await (await import('/management-api.js')).api(path, body);
        return null;
      } catch (error) {
        return error.message;
      }
    },
    { path, body },
  );
}
async function assertDraft() {
  assert.equal(
    await page.getByLabel('Nome do pedido', { exact: true }).inputValue(),
    'Sessão longa',
  );
  assert.equal(
    await page.getByLabel('Nome do produto', { exact: true }).inputValue(),
    'Produto de teste',
  );
  assert.equal(
    await page.getByLabel('Informações do produto e orientações').inputValue(),
    'Direção sintética preservada.',
  );
  assert.deepEqual(
    await page
      .getByLabel('Imagens de referência para o Flow')
      .evaluate((input) => [...input.files].map((file) => file.name)),
    ['reference.png', 'second.png'],
  );
  assert.equal(
    await page
      .getByRole('radio', { name: 'Usar second.png no Flow', exact: true })
      .isChecked(),
    true,
  );
}
async function fillDraft() {
  await page.goto(`${base}/orders`);
  await page.getByText('Nenhum pedido salvo.', { exact: true }).waitFor();
  await page.getByLabel('Nome do pedido', { exact: true }).fill('Sessão longa');
  await page
    .getByLabel('Nome do produto', { exact: true })
    .fill('Produto de teste');
  await page
    .getByLabel('Informações do produto e orientações')
    .fill('Direção sintética preservada.');
  await page.getByLabel('Imagens de referência para o Flow').setInputFiles([
    {
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: await readFile('scripts/fixtures/reference.png'),
    },
    {
      name: 'second.png',
      mimeType: 'image/png',
      buffer: await readFile('scripts/fixtures/reference.png'),
    },
  ]);
  await page
    .getByRole('radio', { name: 'Usar second.png no Flow', exact: true })
    .check();
}
async function recoverWhileConnected() {
  const client = await requestConnection(base, 'a'.repeat(32));
  await api(`/manage/requests/${client.requestId}`, { approve: true });
  socket = await authenticateConnection(base, client);
  const before = count('/manage/session');
  await context.clearCookies();
  await page.evaluate(async () => {
    const { api } = await import('/management-api.js');
    await Promise.all(Array.from({ length: 4 }, () => api('/manage/orders')));
  });
  assert.equal(
    count('/manage/session') - before,
    1,
    'Concurrent failures should share a renewal',
  );
  assert.equal(socket.readyState, 1);
  assert.equal((await api('/manage/status')).clients[0].connected, true);
  await assertDraft();
  const proactive = count('/manage/session');
  await page.clock.setFixedTime(new Date(Date.now() + 21 * 60 * 1000));
  await api('/manage/orders');
  assert.equal(
    count('/manage/session') - proactive,
    1,
    'Active pages should renew before thirty minutes',
  );
  await assertDraft();
}
async function recoverAfterRestart() {
  socket.terminate();
  socket = null;
  await app.close();
  app = createApp(config);
  await app.listen({ host: '127.0.0.1', port: config.port });
  const before = count('/manage/session');
  await api('/manage/orders');
  assert.equal(count('/manage/session') - before, 1);
  await assertDraft();
}
async function verifyFailures() {
  await context.clearCookies();
  await page.route('**/manage/session', (route) =>
    route.fulfill({ status: 503, json: { error: 'fixture' } }),
  );
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('#status')
      .textContent.includes('Não foi possível renovar a sessão'),
  );
  assert.equal(
    (await page.locator('#status').textContent()).includes(
      'Management session required',
    ),
    false,
  );
  await assertDraft();
  await page.unroute('**/manage/session');
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('#status').textContent === '',
  );
  const before = count('/manage/session');
  await page.route('**/manage/orders', (route) =>
    route.fulfill({
      status: 403,
      json: { error: 'Management origin mismatch' },
    }),
  );
  assert.match(await failure('/manage/orders'), /não pôde autorizar/);
  assert.equal(
    count('/manage/session'),
    before,
    'A different refusal must not renew or retry',
  );
  await page.unroute('**/manage/orders');
  const reads = count('/manage/orders', 'GET');
  await page.route('**/manage/orders', (route) =>
    route.fulfill({
      status: 403,
      json: {
        code: 'MANAGEMENT_SESSION_REQUIRED',
        error: 'Management session required',
      },
    }),
  );
  assert.match(
    await failure('/manage/orders'),
    /Não foi possível renovar a sessão/,
  );
  assert.equal(count('/manage/session') - before, 1);
  assert.equal(
    count('/manage/orders', 'GET') - reads,
    2,
    'Recovery is limited to a single retry',
  );
  await page.unroute('**/manage/orders');
  await assertDraft();
}
async function verifyWritesAndBinary() {
  await context.clearCookies();
  const before = count('/manage/orders');
  await page
    .getByRole('button', { name: 'Salvar pedido', exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector('#status').textContent.includes('Pedido 1 salvo'),
  );
  assert.equal(count('/manage/orders') - before, 1);
  assert.equal(
    database.prepare('SELECT count(*) AS n FROM production_orders').get().n,
    1,
  );
  assert.equal(
    database.prepare('SELECT count(*) AS n FROM materials').get().n,
    1,
  );
  const row = database.prepare('SELECT id,body FROM production_orders').get();
  const order = JSON.parse(row.body);
  assert.equal(order.name, 'Sessão longa');
  assert.equal(order.products[0].information, 'Direção sintética preservada.');
  await context.clearCookies();
  const bytes = await page.evaluate(async (id) => {
    const blob = await (
      await import('/management-api.js')
    ).api(`/manage/materials/${id}`, undefined, {}, true);
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, order.products[0].referenceId);
  assert.deepEqual(bytes, [
    ...(await readFile('scripts/fixtures/reference.png')),
  ]);
  const path = `/manage/orders/${row.id}/cancel`;
  const writes = count(path);
  await page.route(`${base}${path}`, async (route) => {
    const committed = await route.fetch();
    assert.equal(committed.status(), 200);
    await route.abort('failed');
  });
  assert.match(await failure(path, {}), /Confira o estado da operação/);
  assert.equal(
    count(path) - writes,
    1,
    'A lost write response must not be replayed',
  );
  assert.equal(
    database.prepare('SELECT state FROM production_orders').get().state,
    'cancelled',
  );
  await page.unroute(`${base}${path}`);
  const renewals = count('/manage/session');
  await page.route(`${base}${path}`, (route) =>
    route.fulfill({ status: 500, json: { error: 'Falha sintética.' } }),
  );
  assert.match(await failure(path, {}), /Falha sintética/);
  assert.equal(
    count(path) - writes,
    2,
    'Server failures must not trigger a retry',
  );
  assert.equal(count('/manage/session'), renewals);
  await page.unroute(`${base}${path}`);
}
try {
  await app.listen({ host: '127.0.0.1', port: config.port });
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  context = await browser.newContext();
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/manage/'))
      requests.push({ path, method: request.method() });
  });
  await fillDraft();
  await recoverWhileConnected();
  await recoverAfterRestart();
  await verifyFailures();
  await verifyWritesAndBinary();
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
    'Chrome isolado: sessão renovada com extensão conectada, concorrência, renovação antecipada, reinício, rascunho e arquivos preservados, erro em português, recuperação limitada, upload/download e ausência de reenvio após falha de escrita passaram. Sem geração ou despacho.',
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
