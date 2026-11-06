import {
  selectedFiles,
  verifyReferencePicker,
  verifyMultipleReferences,
  verifyReferenceLimits,
} from './test-support/reference-images-browser.mjs';
import { preparationFormatLabels } from '../packages/protocol/dist/index.js';
import { installInstructions } from './test-support/instruction-package.mjs';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';
import { createApp } from '../packages/orchestrator/dist/app.js';
import { loadConfig } from '../packages/orchestrator/dist/config.js';
import { checkout, localClient } from './orders.mjs';

const directory = resolve('.cache', `browser-cloning-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const base = 'http://127.0.0.1:4329';
const config = loadConfig({
  PORT: '4329',
  DATABASE_PATH: resolve(directory, 'state.sqlite'),
  LIBRARY_DIR: resolve(directory, 'instructions'),
  LOG_LEVEL: 'silent',
});
installInstructions(config.libraryDirectory);
let app = createApp(config);
let browser;
let page;
const errors = [];

async function readyVideo(locator) {
  await locator.waitFor();
  await locator.evaluate((video) =>
    video.readyState >= 1
      ? undefined
      : new Promise((resolve, reject) => {
          video.addEventListener('loadedmetadata', resolve, { once: true });
          video.addEventListener(
            'error',
            () => reject(new Error('Video preview failed')),
            { once: true },
          );
        }),
  );
  assert.ok(await locator.evaluate((video) => video.videoWidth > 0));
  await locator.evaluate(async (video) => {
    video.muted = true;
    await video.play();
    video.pause();
  });
}
async function capture(name) {
  for (const width of [320, 390, 1081, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: resolve(directory, `${name}-${width}.png`),
      fullPage: true,
    });
  }
}
async function verifyAdditionalCleared() {
  const product = page.locator('.product').first();
  const additional = product.locator('.additional-materials');
  const picker = additional.locator('input[type="file"]');
  assert.deepEqual(await selectedFiles(picker), []);
  assert.equal(await picker.inputValue(), '');
  assert.equal(await additional.locator('.file-list li').count(), 0);
  assert.equal(await additional.locator('video').count(), 0);
  assert.deepEqual(
    await selectedFiles(
      product.getByLabel('Imagens de referência para o Flow'),
    ),
    ['reference.png', 'another-view.png'],
  );
  assert.equal(
    await product.locator('.reference-selection img').first().isVisible(),
    true,
  );
  assert.equal(
    await product
      .getByRole('radio', {
        name: 'Usar another-view.png no Flow',
        exact: true,
      })
      .isChecked(),
    true,
  );
}
async function verifyModeSwitching(group, picker) {
  const standardMode = group.getByRole('radio', {
    name: 'Usar formatos padrão',
    exact: true,
  });
  const cloneMode = group.getByRole('radio', {
    name: 'Clonar um vídeo',
    exact: true,
  });
  const standardFormat = group.getByLabel('Formato', { exact: true });
  const reference = group.locator('.clone-reference');
  assert.equal(await standardMode.isChecked(), true);
  assert.equal(await reference.isVisible(), false);
  assert.equal(await group.locator('select').count(), 1);
  assert.equal(
    await standardFormat.locator('option').count(),
    Object.keys(preparationFormatLabels).filter((format) => format !== 'clone')
      .length,
  );
  assert.equal(await standardFormat.locator('option[value=""]').count(), 0);
  await standardFormat.selectOption('factory-truck');
  await readyVideo(page.locator('.additional-materials video'));
  await picker.setInputFiles({
    name: 'switch-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic supporting notes.'),
  });
  assert.equal(await page.locator('.additional-materials li').count(), 2);
  await cloneMode.check();
  await verifyAdditionalCleared();
  assert.equal(await standardMode.isChecked(), false);
  assert.equal(await standardFormat.inputValue(), '');
  assert.equal(await standardFormat.isDisabled(), true);
  assert.equal(
    await standardFormat.evaluate((select) => select.required),
    false,
  );
  assert.equal(await reference.isVisible(), true);
  assert.ok((await reference.innerText()).includes('Importe um MP4'));
  assert.equal(await picker.evaluate((input) => input.checkValidity()), false);
  await group.getByLabel('Variações', { exact: true }).fill('1');
  await picker.setInputFiles('scripts/fixtures/blue.mp4');
  assert.ok((await reference.innerText()).includes('blue.mp4'));
  assert.equal(await picker.evaluate((input) => input.checkValidity()), true);
  await standardMode.check();
  await verifyAdditionalCleared();
  assert.equal(await cloneMode.isChecked(), false);
  assert.equal(await standardFormat.inputValue(), '');
  assert.equal(
    await standardFormat.evaluate((select) => select.required),
    true,
  );
  assert.equal(
    await standardFormat.evaluate((select) => select.checkValidity()),
    false,
  );
  assert.equal(await reference.isVisible(), false);
  assert.equal(await picker.evaluate((input) => input.checkValidity()), true);
  assert.equal(
    await group.getByLabel('Variações', { exact: true }).inputValue(),
    '1',
  );
  await standardFormat.selectOption('factory-group');
  await picker.setInputFiles('scripts/fixtures/blue.mp4');
  await cloneMode.check();
  await verifyAdditionalCleared();
  assert.equal(await standardFormat.inputValue(), '');
  await picker.setInputFiles('scripts/fixtures/blue.mp4');
  assert.ok((await reference.innerText()).includes('blue.mp4'));
  return reference;
}
async function createOrder() {
  await page.goto(`${base}/orders`);
  await page
    .getByLabel('Nome do pedido', { exact: true })
    .fill('Clonagem com vídeo de referência');
  await page
    .getByLabel('Nome do produto', { exact: true })
    .fill('Produto sintético');
  await page
    .getByLabel('Informações do produto e orientações')
    .fill('Produto de teste; não gerar no Flow.');
  const picker = page.getByLabel(
    'Materiais adicionais (fotos, prints, documentos ou vídeos)',
  );
  await picker.setInputFiles('scripts/fixtures/blue.mp4');
  await verifyReferencePicker(page);
  const secondaryImage = await verifyMultipleReferences(page);
  await verifyReferenceLimits(page);
  assert.deepEqual(await selectedFiles(picker), ['blue.mp4']);
  const group = page.locator('.group').first();
  const reference = await verifyModeSwitching(group, picker);
  await readyVideo(page.locator('.file-list video'));
  await picker.setInputFiles({
    name: 'other.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.concat([
      await readFile('scripts/fixtures/blue.mp4'),
      Buffer.alloc(8),
    ]),
  });
  assert.deepEqual(await selectedFiles(picker), ['blue.mp4', 'other.mp4']);
  assert.equal(await picker.evaluate((input) => input.checkValidity()), false);
  assert.ok((await reference.innerText()).includes('Mantenha apenas um MP4'));
  assert.equal(
    await page
      .getByText('Use apenas um vídeo de referência por produto.', {
        exact: false,
      })
      .isVisible(),
    true,
  );
  await page
    .getByRole('button', { name: 'Salvar pedido', exact: true })
    .click();
  assert.equal(
    await page.getByText('Nenhum pedido salvo.', { exact: true }).isVisible(),
    true,
  );
  await page
    .locator('.file-list li')
    .filter({ hasText: 'other.mp4' })
    .getByRole('button', { name: 'Remover', exact: true })
    .click();
  assert.deepEqual(await selectedFiles(picker), ['blue.mp4']);
  assert.equal(await picker.evaluate((input) => input.checkValidity()), true);
  assert.ok((await reference.innerText()).includes('blue.mp4'));
  await page
    .locator('.file-list li')
    .filter({ hasText: 'blue.mp4' })
    .getByRole('button', { name: 'Remover', exact: true })
    .click();
  assert.deepEqual(await selectedFiles(picker), []);
  assert.equal(await picker.evaluate((input) => input.checkValidity()), false);
  assert.ok((await reference.innerText()).includes('Importe um MP4'));
  await picker.setInputFiles('scripts/fixtures/blue.mp4');
  assert.deepEqual(await selectedFiles(picker), ['blue.mp4']);
  assert.equal(await picker.evaluate((input) => input.checkValidity()), true);
  assert.ok((await reference.innerText()).includes('blue.mp4'));
  assert.deepEqual(
    await selectedFiles(page.getByLabel('Imagens de referência para o Flow')),
    ['reference.png', 'another-view.png'],
  );
  await readyVideo(page.locator('.file-list video'));
  await page
    .getByRole('button', { name: 'Adicionar formato', exact: true })
    .click();
  const standard = page.locator('.group').last();
  await standard
    .getByLabel('Formato', { exact: true })
    .selectOption('factory-group');
  await standard.getByLabel('Variações', { exact: true }).fill('1');
  await capture('clone-form');
  await page
    .getByRole('button', { name: 'Salvar pedido', exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector('#status').textContent.includes('Pedido 1 salvo'),
  );
  return secondaryImage;
}
async function verifySavedVideo() {
  const details = page.locator('#orders .order-details').first();
  if (!(await details.evaluate((node) => node.open)))
    await details.locator(':scope > summary').click();
  const summary = page.getByText(/vídeo de referência: blue.mp4/, {
    exact: false,
  });
  await summary.click();
  await readyVideo(page.locator('#orders video'));
  await summary.click();
}
async function verifyImageOnlyOrder(api) {
  await page.getByLabel('Nome do pedido', { exact: true }).fill('Somente foto');
  await page
    .getByLabel('Nome do produto', { exact: true })
    .fill('Produto padrão');
  const reference = page.getByLabel('Imagens de referência para o Flow');
  await reference.setInputFiles('scripts/fixtures/reference.png');
  await page
    .getByRole('button', { name: 'Salvar pedido', exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector('#status').textContent.includes('Pedido 2 salvo'),
  );
  const { order } = await api('/manage/orders/2');
  assert.deepEqual(order.products[0].materials, [
    order.products[0].referenceId,
  ]);
  assert.equal(order.products[0].groups[0].format, 'factory');
}
function completePreparation(preparation) {
  for (const product of preparation.products)
    for (const variation of product.variations) {
      variation.hookImage = {
        prompt: 'Foto sintética do produto nas mãos.',
        negative_prompt: 'Sem texto.',
        aspect_ratio: '9:16',
      };
      variation.presenterImage = {
        prompt: 'Produto sintético apoiado no balcão.',
        negative_prompt: 'Sem bandeja.',
        aspect_ratio: '9:16',
      };
      variation.copy = {
        hook: 'Conheça este produto.',
        body: 'Veja os detalhes.',
        cta: 'Confira no carrinho.',
      };
      if (variation.cloneVideo) {
        variation.cloneVideo.analysis =
          'Quadro azul sintético observado na referência; adaptação de teste, sem execução paga.';
        variation.cloneVideo.directions = {
          hook: 'Keep only hands visible, with off-camera voice.',
          body: 'Keep the product on the counter.',
          cta: 'Use the same initial frame and speak naturally.',
        };
      }
    }
  return preparation;
}
async function verifyCheckoutAndPublish(api, order, secondaryImage) {
  const folder = resolve(directory, 'checkout');
  await checkout(api, order.number, 'agent-fixture', folder);
  const preparation = JSON.parse(
    await readFile(resolve(folder, 'preparacao.json'), 'utf8'),
  );
  const cloned = preparation.products[0].variations.find(
    (variation) => variation.format === 'clone',
  );
  const referenceId = order.products[0].referenceId;
  const primary = order.materials.find(
    (material) => material.id === referenceId,
  );
  assert.equal(primary.name, 'another-view.png');
  assert.equal(order.products[0].materials.length, 3);
  for (const material of order.materials.filter((material) =>
    material.mime.startsWith('image/'),
  )) {
    const expected =
      material.id === referenceId
        ? secondaryImage
        : await readFile('scripts/fixtures/reference.png');
    assert.deepEqual(
      await readFile(resolve(folder, `${material.id}.png`)),
      expected,
    );
  }
  const videoId = order.products[0].groups[0].videoReferenceId;
  assert.equal(cloned.cloneVideo.materialId, videoId);
  assert.equal(cloned.cloneVideo.analysis, '');
  const bytes = await readFile(resolve(folder, `${videoId}.mp4`));
  assert.deepEqual(bytes, await readFile('scripts/fixtures/blue.mp4'));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    order.materials.find((material) => material.id === videoId).sha256,
  );
  completePreparation(preparation);
  const wrong = globalThis.structuredClone(preparation);
  wrong.products[0].variations.find(
    (variation) => variation.format === 'clone',
  ).cloneVideo.materialId = randomUUID();
  await assert.rejects(
    api(`/manage/orders/${order.id}/prepare`, wrong),
    /pedido salvo/,
  );
  await writeFile(
    resolve(folder, 'preparacao.json'),
    JSON.stringify(preparation),
  );
  const result = await api(`/manage/orders/${order.id}/prepare`, preparation);
  assert.equal(result.state, 'prepared');
  assert.equal(
    result.preparation.manifests.flatMap((manifest) => manifest.tasks).length,
    6,
  );
  const takes = result.preparation.manifests
    .flatMap((manifest) => manifest.tasks)
    .filter((take) => take.video.startsWith('clone'));
  assert.equal(takes.length, 3);
  assert.equal(takes[2].reuseImageFrom, takes[1].id);
  assert.ok(
    takes[0].original.videoPrompt.includes(cloned.cloneVideo.directions.hook),
  );
  assert.ok(
    result.preparation.manifests
      .flatMap((manifest) => manifest.tasks)
      .every((take) => take.reference === `${referenceId}.png`),
  );
  return videoId;
}
async function verifyReviewAndCleanup(api, videoId) {
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await page.getByRole('button', { name: 'Ver prévia', exact: true }).click();
  await page
    .getByText(/análise e adaptação do vídeo/, { exact: false })
    .click();
  assert.ok(
    await page
      .getByText(/Quadro azul sintético observado/, { exact: false })
      .isVisible(),
  );
  await capture('clone-review');
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
  await page.locator('#orders .order-details > summary').click();
  await page
    .getByRole('button', { name: 'Cancelar pedido', exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector('#orders .badge').textContent === 'Cancelado',
  );
  assert.equal((await api('/manage/cleanup', { ids: [videoId] })).removed, 1);
  const { order } = await api('/manage/orders/1');
  assert.equal(
    order.materials.find((material) => material.id === videoId).available,
    false,
  );
}
try {
  await app.listen({ host: '127.0.0.1', port: 4329 });
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  const secondaryImage = await createOrder();
  await verifySavedVideo();
  let api = await localClient(base);
  const saved = (await api('/manage/orders/1')).order;
  assert.equal(saved.products[0].groups[0].format, 'clone');
  assert.equal(saved.products[0].groups[1].format, 'factory-group');
  await page.goto('about:blank');
  await app.close();
  app = createApp(config);
  await app.listen({ host: '127.0.0.1', port: 4329 });
  api = await localClient(base);
  await page.goto(`${base}/orders`);
  await verifySavedVideo();
  const order = (await api('/manage/orders/1')).order;
  assert.deepEqual(order.products, saved.products);
  const videoId = await verifyCheckoutAndPublish(api, order, secondaryImage);
  await verifyReviewAndCleanup(api, videoId);
  await verifyImageOnlyOrder(api);
  assert.deepEqual(errors, []);
  console.log(
    'Chrome with local fixtures: multiple reference images, accumulated batches, primary image choice, individual removal, file limits, image-only standard order, image/MP4 previews, automatic single-video binding, multiple-video rejection, persistence after restart, exact agent files and primary manifest reference, review and protected cleanup passed. No generation or dispatch.',
  );
  console.log(`Isolated evidence: ${directory}`);
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
