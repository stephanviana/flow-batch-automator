import { authorizeFixtureRetry } from './browser-flow-retry.mjs';
import { createFlowRpcFixture } from './browser-flow-rpc.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localClient, checkout } from './orders.mjs';
import {
  usesSingleImage,
  DEFAULT_ORDER_VIDEO_MODEL,
} from '../packages/protocol/dist/index.js';
import { resolve } from 'node:path';

export async function validateFlowTake({
  browser,
  panel,
  eventually,
  stopServer,
  startServer,
  media,
  directory,
  format = 'factory',
  videoModel = DEFAULT_ORDER_VIDEO_MODEL,
  base = 'http://127.0.0.1:4319',
}) {
  const singleImage = usesSingleImage(format);
  const retryScenario = format === 'factory';
  const referenceBytes = await readFile(
    new URL('./fixtures/reference.png', import.meta.url),
  );
  const fixture = await createFlowRpcFixture(
    browser,
    videoModel,
    retryScenario,
    referenceBytes,
    format === 'seller',
  );
  const flow = await browser.newPage();
  const orders = await browser.newPage();
  const panelUrl = panel.url();
  let api = await localClient(base);
  try {
    await flow.goto(`https://flow.google.com/project/${fixture.projectId}`);
    await orders.goto(`${base}/orders`);
    const videoPicker = orders.getByLabel('Modelo de vídeo no Flow', {
      exact: true,
    });
    assert.equal(await videoPicker.inputValue(), DEFAULT_ORDER_VIDEO_MODEL);
    await videoPicker.selectOption(videoModel);
    await orders
      .getByLabel('Nome do pedido', { exact: true })
      .fill('Pedido navegador');
    await orders
      .getByLabel('Nome do produto', { exact: true })
      .fill('Produto fixture');
    await orders
      .getByLabel('Informações do produto e orientações')
      .fill('Material de teste sintético.');
    await orders.getByLabel('Imagens de referência para o Flow').setInputFiles({
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: referenceBytes,
    });
    await orders.getByLabel('Variações', { exact: true }).fill('1');
    await orders.getByLabel('Formato', { exact: true }).selectOption(format);
    await orders
      .getByRole('button', { name: 'Salvar pedido', exact: true })
      .click();
    await eventually(async () =>
      (await orders.locator('#status').textContent()).includes(
        'Pedido 1 salvo',
      ),
    );
    const { order, variationPlan } = await api('/manage/orders/1');
    assert.equal(order.state, 'awaiting-preparation');
    assert.equal(order.videoModel, videoModel);
    assert.equal(fixture.imageCount, 0);
    assert.equal(fixture.videoCount, 0);
    assert.equal(fixture.projectsCreated, 0);
    const checkoutDirectory = resolve(directory, 'agent-checkout');
    await checkout(api, order.number, 'browser-fixture', checkoutDirectory);
    const { leaseId } = JSON.parse(
      await readFile(resolve(checkoutDirectory, 'pedido.json'), 'utf8'),
    );
    assert.deepEqual(
      await readFile(
        resolve(checkoutDirectory, `${order.materials[0].id}.png`),
      ),
      referenceBytes,
    );
    const variation = variationPlan[0];
    const checkoutPlan = JSON.parse(
      await readFile(resolve(checkoutDirectory, 'preparacao.json'), 'utf8'),
    );
    assert.equal(
      'presenterImage' in checkoutPlan.products[0].variations[0],
      !singleImage,
    );
    const prepared = await api(`/manage/orders/${order.id}/prepare`, {
      leaseId,
      products: [
        {
          id: order.products[0].id,
          variations: [
            {
              id: variation.id,
              name: variation.name,
              format: variation.format,
              hookImage: {
                prompt: 'Produto de teste na fábrica',
                negative_prompt: 'Sem texto',
                aspect_ratio: '9:16',
              },
              ...(!singleImage
                ? {
                    presenterImage: {
                      prompt: 'Produto de teste no balcão',
                      negative_prompt: 'Sem bandeja',
                      aspect_ratio: '9:16',
                    },
                  }
                : {}),
              copy: {
                hook: 'Gancho de teste.',
                body: 'Apresentação de teste.',
                cta: 'Confira o produto de teste.',
              },
            },
          ],
        },
      ],
    });
    assert.equal(prepared.state, 'prepared');
    assert.equal(fixture.imageCount, 0);
    assert.equal(fixture.videoCount, 0);
    fixture.expectedTasks = prepared.preparation.manifests[0].tasks;
    for (const task of fixture.expectedTasks)
      assert.equal(task.videoModel, videoModel);
    assert.equal(
      fixture.expectedTasks[1].reuseImageFrom,
      singleImage ? fixture.expectedTasks[0].id : undefined,
    );
    assert.equal(
      fixture.expectedTasks[2].reuseImageFrom,
      fixture.expectedTasks[singleImage ? 0 : 1].id,
    );
    await orders
      .getByRole('button', { name: 'Atualizar', exact: true })
      .click();
    await eventually(async () =>
      (await orders.locator('#orders').textContent()).includes('Prévia pronta'),
    );
    await orders
      .getByRole('button', { name: 'Ver prévia', exact: true })
      .click();
    await orders
      .getByText(`Produto fixture · ${format} 1 · falas`, { exact: true })
      .click();
    await orders.screenshot({
      path: resolve(directory, 'orders.png'),
      fullPage: true,
    });
    const { clients } = await api('/manage/status'),
      clientId = clients.find((client) => !client.revokedAt).id;
    await panel.goto('about:blank');
    await orders.close();
    await api(`/manage/orders/${order.id}/approve`, {
      approve: true,
      clientId,
    });
    if (retryScenario) {
      await panel.goto(panelUrl);
      await panel
        .getByRole('tab', { name: 'Fila e gerações', exact: true })
        .click();
      await eventually(() => fixture.videoRequests === 1, 40000);
      await panel
        .getByRole('button', { name: 'Pausar fila', exact: true })
        .click();
      await panel
        .getByRole('button', { name: 'Processar fila', exact: true })
        .waitFor();
      fixture.reportFailure();
      await eventually(async () => {
        const { tasks } = await api('/manage/orders/1/diagnostics');
        return tasks[0]?.task.state === 'failed';
      }, 40000);
      assert.equal(fixture.videoRequests, 1);
      assert.equal(fixture.videoCount, 0);
      const task = panel
        .locator('[data-task-id]')
        .filter({
          has: panel.getByRole('button', {
            name: 'Verificar resultado no Flow',
            exact: true,
          }),
        })
        .first();
      await task
        .getByRole('button', {
          name: 'Verificar resultado no Flow',
          exact: true,
        })
        .click();
      await eventually(async () =>
        (
          await panel
            .locator('#flow-check-result')
            .textContent()
            .catch(() => '')
        ).includes('PUBLIC_ERROR_UNSAFE_GENERATION'),
      );
      assert.match(
        await panel.locator('#flow-check-result').textContent(),
        /Imagem de origem na listagem: localizada/,
      );
      assert.match(
        await panel.locator('#flow-check-result').textContent(),
        /Consulta direta da imagem: acessível/,
      );
      assert.equal(
        fixture.videoRequests,
        1,
        'Checking an existing operation never generates another video',
      );
      assert.equal(
        fixture.imageCount,
        1,
        'Checking an existing operation never generates another image',
      );
      await panel.goto('about:blank');
      fixture.captureRetryReload();
      await authorizeFixtureRetry(browser, base, (content) => {
        fixture.expectedTasks[0].original = {
          ...fixture.expectedTasks[0].original,
          copy: content.copy,
          videoPrompt: content.videoPrompt,
        };
        fixture.recover();
      });
    }
    await eventually(
      async () => (await api('/manage/orders/1')).order.state === 'completed',
      120000,
    );
    assert.equal(fixture.projectsCreated, 1);
    if (retryScenario)
      assert.equal(fixture.projectLoads, fixture.loadsBeforeRetry + 1);
    const expectedImageCount = singleImage ? 1 : 2;
    assert.equal(fixture.imageCount, expectedImageCount);
    assert.equal(fixture.uploadCount, expectedImageCount);
    assert.equal(fixture.videoCount, 3);
    assert.equal(fixture.videoRequests, 3 + Number(retryScenario));
    assert.equal(fixture.refusedProjectReads, Number(retryScenario));
    assert.equal(fixture.refusedLinkReads, Number(retryScenario));
    assert.equal(
      browser
        .pages()
        .filter((page) => page.url().startsWith('https://flow.google.com/'))
        .length,
      1,
    );
    const worker = browser.serviceWorkers()[0];
    const downloads = await worker.evaluate(async () =>
      chrome.downloads.search({ state: 'complete' }),
    );
    assert.equal(downloads.length, 3);
    const folders = new Set();
    const formatName = {
      factory: 'fabrica-padrao',
      pov: 'pov-vendedora',
      'full-pov': 'full-pov',
      seller: 'full-vendedora',
    }[format];
    const variationId = fixture.expectedTasks[0].output.groupId.replaceAll(
      '-',
      '',
    );
    for (const download of downloads) {
      assert.ok(download.filename.includes('/.cache/browser-'));
      const folder = download.filename.replace(/[^/]+$/, '');
      assert.match(
        folder,
        new RegExp(
          `/Flow/Videos/produto-fixture--${formatName}--[a-f0-9]{8}-${variationId}/$`,
        ),
      );
      folders.add(folder);
      assert.deepEqual(await readFile(download.filename), media.video);
    }
    assert.equal(folders.size, 1);
    assert.deepEqual(
      downloads.map((download) => download.filename.split('/').at(-1)).sort(),
      ['01-Gancho.mp4', '02-Body.mp4', '03-CTA.mp4'],
    );
    const databaseNames = await worker.evaluate(async () =>
      (await indexedDB.databases()).map((database) => database.name),
    );
    assert.equal(databaseNames.includes('flow-batch-preparations'), false);
    const completed = (await api('/manage/orders/1')).order;
    assert.equal(
      completed.materials[0].sha256,
      createHash('sha256').update(referenceBytes).digest('hex'),
    );
    await stopServer();
    await startServer();
    api = await localClient(base);
    assert.equal((await api('/manage/orders/1')).order.state, 'completed');
    const cleanup = await api('/manage/cleanup');
    assert.equal(cleanup.materials.length, 1);
    assert.equal(
      (
        await api('/manage/cleanup', {
          ids: cleanup.materials.map((material) => material.id),
        })
      ).removed,
      1,
    );
    assert.equal(
      (await api('/manage/orders/1')).order.materials[0].available,
      false,
    );
    assert.equal(
      (await api('/manage/orders/1')).order.preparationHash,
      prepared.preparationHash,
    );
    await panel.goto(panelUrl);
    await panel
      .getByRole('tab', { name: 'Fila e gerações', exact: true })
      .click();
    await eventually(
      async () =>
        (await panel.locator('#queue-tasks').textContent()).includes(
          'Concluída',
        ),
      40000,
    );
    assert.deepEqual(
      (await panel.locator('.task-output').allTextContents()).sort(),
      ['MP4: 01-Gancho.mp4', 'MP4: 02-Body.mp4', 'MP4: 03-CTA.mp4'],
    );
    assert.equal(fixture.imageCount, expectedImageCount);
    assert.equal(fixture.videoCount, 3);
    console.log(
      `Chrome isolado (${format}): pedido pelo painel, checkout, preparação, autorização, ${singleImage ? 'uma imagem compartilhada pelos três takes' : 'duas imagens com CTA reutilizado'}, três MP4s, painel fechado, reinício e limpeza passaram com fixtures locais.`,
    );
  } finally {
    fixture.reportFailure();
    await orders.close().catch(() => {});
    media.releaseDownload();
    await flow.close().catch(() => {});
    await browser.unroute('https://flow.google.com/**').catch(() => {});
  }
}
