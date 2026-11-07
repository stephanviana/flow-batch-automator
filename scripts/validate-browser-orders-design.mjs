import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';
import { usesSingleImage } from '../packages/protocol/dist/index.js';
import { createApp } from '../packages/orchestrator/dist/app.js';
import { loadConfig } from '../packages/orchestrator/dist/config.js';
import { localClient } from './orders.mjs';
import { validateOrdersCleanup } from './browser-orders-cleanup.mjs';
import { installInstructions } from './test-support/instruction-package.mjs';

const directory = resolve('.cache', `orders-design-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const config = loadConfig({
  HOST: '127.0.0.1',
  PORT: '4359',
  LOG_LEVEL: 'silent',
  DATABASE_PATH: resolve(directory, 'state.sqlite'),
  LIBRARY_DIR: resolve(directory, 'library'),
});
installInstructions(config.libraryDirectory);
const app = createApp(config);
let browser;
let page;
const errors = [];
const base = 'http://127.0.0.1:4359';

async function saveOrderFromEditor() {
  await page
    .getByLabel('Nome do pedido', { exact: true })
    .fill('Lote de vídeos 04/11');
  const names = [
    'Mini ar-condicionado',
    'Jogo de 30 marmitas',
    'Garrafa térmica',
  ];
  for (let index = 0; index < names.length; index++) {
    if (index)
      await page
        .getByRole('button', { name: 'Adicionar produto', exact: true })
        .click();
    const product = page.locator('.product').nth(index);
    await product
      .getByLabel('Nome do produto', { exact: true })
      .fill(names[index]);
    await product
      .getByLabel('Imagens de referência para o Flow')
      .setInputFiles('scripts/fixtures/reference.png');
    await product
      .getByLabel('Formato', { exact: true })
      .selectOption(index === 1 ? 'seller' : 'factory');
    await product
      .getByLabel('Variações', { exact: true })
      .fill(index === 2 ? '6' : '3');
  }
  assert.equal(
    await page.locator('#product-count').textContent(),
    '3 produtos',
  );
  await page
    .getByRole('button', { name: 'Salvar pedido', exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector('#status').textContent.includes('Pedido 1 salvo'),
  );
  assert.equal(await page.locator('#product-count').textContent(), '1 produto');
  await page
    .getByRole('button', { name: 'Adicionar produto', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Adicionar produto', exact: true })
    .click();
  await page
    .locator('.product')
    .nth(1)
    .getByRole('button', { name: 'Remover produto', exact: true })
    .click();
  assert.deepEqual(await page.locator('.product-number').allTextContents(), [
    '01',
    '02',
  ]);
  await page
    .locator('.product')
    .last()
    .getByRole('button', { name: 'Remover produto', exact: true })
    .click();
}
async function prepareFixture() {
  const lastProduct = await page
    .locator('.order-products li')
    .last()
    .boundingBox();
  const details = await page.locator('.order-details > summary').boundingBox();
  assert.ok(
    details.y >= lastProduct.y + lastProduct.height,
    'Details must not overlap an unprepared order',
  );
  const api = await localClient(base);
  const { order } = await api('/manage/orders/1');
  const { leaseId } = await api(`/manage/orders/${order.id}/claim`, {
    worker: 'design-fixture',
  });
  const { variationPlan } = await api('/manage/orders/1');
  await api(`/manage/orders/${order.id}/prepare`, {
    leaseId,
    products: order.products.map((product) => ({
      id: product.id,
      variations: variationPlan
        .filter((variation) => variation.productId === product.id)
        .map(({ id, name, format }) => ({
          id,
          name,
          format,
          copy: {
            hook: 'Gancho sintético.',
            body: 'Detalhes sintéticos.',
            cta: 'Confira o produto.',
          },
          hookImage: {
            prompt: 'Imagem sintética de teste.',
            negative_prompt: 'Sem texto.',
            aspect_ratio: '9:16',
          },
          ...(!usesSingleImage(format)
            ? {
                presenterImage: {
                  prompt: 'Produto sintético no balcão.',
                  negative_prompt: 'Sem texto.',
                  aspect_ratio: '9:16',
                },
              }
            : {}),
        })),
    })),
  });
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await page.getByRole('button', { name: 'Ver prévia', exact: true }).waitFor();
  assert.match(
    await page.locator('.generation-counts').innerText(),
    /21 imagens/,
  );
  assert.match(
    await page.locator('.generation-counts').innerText(),
    /36 vídeos/,
  );
  assert.deepEqual(
    await page.locator('.order-products li').allTextContents(),
    order.products.map((product) => product.name),
  );
}
async function captureResponsive() {
  await page
    .getByLabel('Nome do pedido', { exact: true })
    .fill('Campanha novembro');
  await page.evaluate(() => {
    document.querySelector('#status').textContent = '';
    document.activeElement.blur();
  });
  for (const width of [1536, 1920, 1081, 960, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1024 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
      true,
      `Overflow at ${width}px`,
    );
    const editor = await page.locator('.order-editor').boundingBox();
    const sidebar = await page.locator('.order-sidebar').boundingBox();
    if (width > 960) {
      assert.ok(Math.abs(editor.y - sidebar.y) < 1);
      assert.ok(sidebar.x >= editor.x + editor.width);
    } else assert.ok(sidebar.y >= editor.y + editor.height);
    if (width === 1536) {
      assert.equal(editor.x, 40);
      assert.ok(Math.abs(editor.width - 971) < 2);
    }
    await page.screenshot({
      path: resolve(directory, `orders-${width}.png`),
      fullPage: true,
    });
  }
}
async function verifyControls() {
  await page.setViewportSize({ width: 1536, height: 1024 });
  const toggle = page.getByRole('button', {
    name: 'Recolher produto',
    exact: true,
  });
  await toggle.click();
  assert.equal(await page.locator('.product-body').isVisible(), false);
  await page.locator('#order-form').evaluate((form) => form.reportValidity());
  assert.equal(await page.locator('.product-body').isVisible(), true);
  await page
    .getByRole('button', { name: 'Adicionar formato', exact: true })
    .click();
  assert.equal(await page.locator('.group').count(), 2);
  await page
    .getByRole('button', { name: 'Remover formato', exact: true })
    .last()
    .click();
  assert.equal(await page.locator('.group').count(), 1);
  const manage = page.getByRole('button', { name: 'Gerenciar', exact: true });
  await manage.click();
  await page
    .locator('#cleanup')
    .getByText('0 arquivos elegíveis', { exact: false })
    .waitFor();
  assert.equal(await manage.getAttribute('aria-expanded'), 'true');
  await manage.click();
  assert.equal(await page.locator('#storage-details').isVisible(), false);
  await page.getByRole('button', { name: 'Ver prévia', exact: true }).click();
  await page.locator('.preparation-preview').waitFor();
  assert.ok((await page.locator('.preparation-preview details').count()) > 1);
  await page.locator('.order-details > summary').click();
  await page
    .getByRole('button', { name: 'Cancelar pedido', exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector('#orders .badge').textContent === 'Cancelado',
  );
}
async function verifyReviewState() {
  const api = await localClient(base);
  const response = await api('/manage/orders');
  const fixture = globalThis.structuredClone(response);
  fixture.orders[0].state = 'blocked';
  fixture.orders[0].clearable = false;
  fixture.orders[0].dispatches = [
    {
      id: randomUUID(),
      state: 'blocked',
      message: 'Projeto não criado no Flow.',
    },
  ];
  const route = '**/manage/orders';
  await page.route(route, (request) => request.fulfill({ json: fixture }));
  const diagnosisRoute = `**/manage/orders/${fixture.orders[0].number}/diagnostics`;
  await page.route(diagnosisRoute, (request) => {
    assert.equal(request.request().method(), 'GET');
    return request.fulfill({
      json: {
        number: fixture.orders[0].number,
        preparation: {
          published: true,
          message: 'Preparação publicada e preservada.',
        },
        unavailableMaterials: [],
        dispatches: [
          {
            ...fixture.orders[0].dispatches[0],
            review: {
              canResume: true,
              canClose: true,
              closeReason: '',
              reviewHash: 'a'.repeat(64),
              preparationHash: fixture.orders[0].preparationHash,
              images: 2,
              videos: 3,
              reason:
                'Falha anterior ao envio da criação e nenhum take registrado.',
              failure: {
                stage: 'project-creation',
                code: 'project_wait_ready_failed',
                sent: false,
              },
            },
          },
        ],
        tasks: [],
      },
    });
  });
  try {
    await page.setViewportSize({ width: 1536, height: 1024 });
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await page.getByText('Requer revisão', { exact: true }).waitFor();
    assert.equal(
      await page.locator('.order-notice').textContent(),
      'Projeto não criado no Flow.',
    );
    await page
      .getByRole('button', { name: 'Revisar pedido', exact: true })
      .click();
    await page.locator('.order-review[open]').waitFor();
    assert.match(
      await page.locator('.order-review-content').innerText(),
      /project_wait_ready_failed/,
    );
    assert.match(
      await page.locator('.order-review-content').innerText(),
      /antes do envio/,
    );
    assert.match(
      await page.locator('.order-review-content').innerText(),
      /Nenhum take foi registrado/,
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Solicitar nova tentativa no chat' })
        .count(),
      1,
    );
    for (const width of [320, 390, 1536]) {
      await page.setViewportSize({ width, height: 1024 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= globalThis.innerWidth,
        ),
        true,
      );
    }
    await page.screenshot({
      path: resolve(directory, 'orders-review-fixture-1536.png'),
      fullPage: true,
    });
    fixture.orders[0].state = 'completed';
    fixture.orders[0].dispatches[0].state = 'queued';
    fixture.orders[0].dispatches[0].message =
      'Projeto criado e tarefas encaminhadas.';
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await page.getByText('Concluído', { exact: true }).first().waitFor();
    assert.equal(
      await page.locator('.notice-info').textContent(),
      'Projeto criado e tarefas encaminhadas.',
    );
  } finally {
    await page.unroute(route);
    await page.unroute(diagnosisRoute);
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await page.getByText('Prévia pronta', { exact: true }).waitFor();
  }
}
try {
  await app.listen({ host: '127.0.0.1', port: config.port });
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  await page.goto(`${base}/orders`);
  await saveOrderFromEditor();
  await prepareFixture();
  await captureResponsive();
  await verifyReviewState();
  await verifyControls();
  await validateOrdersCleanup(page, base);
  const database = new DatabaseSync(config.databasePath, { readOnly: true });
  assert.equal(
    database.prepare('SELECT count(*) AS n FROM dispatch_commands').get().n,
    0,
  );
  assert.equal(
    database.prepare('SELECT count(*) AS n FROM queue_tasks').get().n,
    0,
  );
  database.close();
  assert.deepEqual(errors, []);
  console.log(
    'Chrome isolado: layout desktop/mobile, pedido com três produtos, anexos, recolhimento, formatos, prévia, detalhes, cancelamento e armazenamento passaram. Sem despacho ou geração.',
  );
  console.log(`Evidências: ${directory}`);
} catch (error) {
  if (page)
    await page
      .screenshot({ path: resolve(directory, 'failure.png'), fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  if (browser) await browser.close();
  await app.close();
}
