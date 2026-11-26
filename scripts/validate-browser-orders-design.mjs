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
  const model = page.getByLabel('Modelo de vídeo no Flow', { exact: true });
  assert.equal(await model.inputValue(), 'abra_i2v_8s');
  await model.selectOption('veo_3_1_i2v_lite');
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
  assert.equal(await model.inputValue(), 'abra_i2v_8s');
  await page.getByText('Modelo: Veo 3.1 Lite', { exact: true }).waitFor();
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
    for (const container of document.querySelectorAll(
      '.order-editor, .order-list',
    ))
      container.scrollTop = 0;
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
    const saved = await page.locator('.order-list').boundingBox();
    assert.ok(
      Math.abs(editor.height - saved.height) < 1,
      'Order containers must have equal heights',
    );
    for (const selector of ['.order-editor', '.order-list']) {
      const overflow = await page
        .locator(selector)
        .evaluate((node) => globalThis.getComputedStyle(node).overflowY);
      assert.equal(overflow, 'scroll', selector);
    }
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
async function measureEditorScroll() {
  return page.locator('.order-editor').evaluate((editor) => ({
    pageHeight: document.documentElement.scrollHeight,
    containerHeight: editor.clientHeight,
    contentHeight: editor.scrollHeight,
  }));
}
async function verifyExpansionScroll() {
  for (const [width, height] of [
    [1360, 784],
    [1360, 640],
    [1536, 1024],
    [960, 640],
    [390, 844],
    [320, 640],
  ]) {
    await page.setViewportSize({ width, height });
    await page
      .getByRole('button', { name: 'Recolher produto', exact: true })
      .click();
    const collapsed = await measureEditorScroll();
    for (let cycle = 0; cycle < 2; cycle++) {
      await page
        .getByRole('button', { name: 'Expandir produto', exact: true })
        .click();
      const expanded = await measureEditorScroll();
      assert.equal(
        expanded.pageHeight,
        collapsed.pageHeight,
        `Expanding a product must preserve page height at ${width}×${height}`,
      );
      assert.equal(expanded.containerHeight, collapsed.containerHeight);
      assert.ok(expanded.contentHeight > collapsed.contentHeight);
      await page
        .getByRole('button', { name: 'Recolher produto', exact: true })
        .click();
      assert.deepEqual(await measureEditorScroll(), collapsed);
    }
    await page
      .getByRole('button', { name: 'Expandir produto', exact: true })
      .click();
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
  await page.locator('.order-details > summary').click();
  await page
    .locator('.order-detail-content')
    .getByText(/Mini ar-condicionado/)
    .waitFor();
  for (const name of [
    'Pausar fila',
    'Retomar fila',
    'Ver diagnóstico',
    'Revisar pedido',
    'Ver prévia',
    'Cancelar pedido',
    'Autorizar tentativa automática',
  ]) {
    assert.equal(
      await page.getByRole('button', { name, exact: true }).count(),
      0,
    );
  }
}
async function verifyCleanupAndScroll() {
  const api = await localClient(base);
  const { order } = await api('/manage/orders/1');
  for (let index = 0; index < 8; index++)
    await api('/manage/orders', {
      id: randomUUID(),
      name: `Pedido sintético ${index + 2}`,
      products: order.products,
      videoModel: order.videoModel,
    });
  const reserved = await api('/manage/orders', {
    id: randomUUID(),
    name: 'Pedido em preparação',
    products: order.products,
  });
  await api(`/manage/orders/${reserved.id}/claim`, { worker: 'fixture' });
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Pedido em preparação', exact: true })
    .waitFor();
  const saved = page.locator('.order-list');
  assert.equal(
    await saved.evaluate((node) => node.scrollHeight > node.clientHeight),
    true,
  );
  assert.equal(
    await page
      .locator('.order-editor')
      .evaluate((node) => node.scrollHeight > node.clientHeight),
    true,
  );
  await saved.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  assert.ok((await saved.evaluate((node) => node.scrollTop)) > 0);
  await page
    .getByLabel('Nome do pedido', { exact: true })
    .fill('Rascunho preservado');
  await page
    .getByRole('button', { name: 'Limpar pedidos', exact: true })
    .click();
  await page
    .locator('#clear-orders-feedback')
    .getByText(/9 pedido/)
    .waitFor();
  assert.deepEqual(
    (await api('/manage/orders')).orders.map(({ id }) => id),
    [reserved.id],
  );
  assert.equal(
    await page.getByLabel('Nome do pedido', { exact: true }).inputValue(),
    'Rascunho preservado',
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Limpar pedidos', exact: true })
      .isDisabled(),
    true,
  );
  await page.reload();
  await page
    .getByRole('heading', { name: 'Pedido em preparação', exact: true })
    .waitFor();
  assert.equal(await page.locator('#orders article').count(), 1);
  const historical = (await api(`/manage/orders/id/${order.id}`)).order;
  assert.notEqual(historical.archivedAt, null);
  assert.equal(
    historical.materials.every(({ available }) => available),
    true,
  );
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
  await verifyExpansionScroll();
  await verifyControls();
  await verifyCleanupAndScroll();
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
    'Chrome isolado: criação com três produtos, anexos, formatos, containers de mesma altura, expansão sem aumentar a rolagem externa e limpeza persistente de pedidos elegíveis passaram.',
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
