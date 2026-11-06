import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { URLSearchParams } from 'node:url';
import { localClient, checkout } from './orders.mjs';
import { usesSingleImage } from '../packages/protocol/dist/index.js';
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
  base = 'http://127.0.0.1:4319',
}) {
  const singleImage = usesSingleImage(format);
  let projectId = randomUUID();
  let imageId = randomUUID();
  const referenceId = randomUUID(),
    operationId = randomUUID(),
    videoId = randomUUID();
  const referenceBytes = await readFile(
    new URL('./fixtures/reference.png', import.meta.url),
  );
  let expectedTasks = [];
  let imageCount = 0,
    videoCount = 0,
    uploadCount = 0,
    mediaCount = 0;
  const captchaTokens = new Set();
  let mode = 'success';
  let expectedVideoModel = 'abra_i2v_8s';
  let expectedImageModel = 'GEM_PIX_2';
  let projectsCreated = 0;
  await browser.route('https://flow.google.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.endsWith('/batchexecute')) {
      await route.fulfill({
        contentType: 'text/html',
        body: `<html lang="pt-BR"><body><script>
        globalThis.WIZ_global_data={SNlM0e:'fixture-at-token',FdrFJe:'fixture-session',cfb2h:'fixture-build'};
        globalThis.__fixtureCaptchaCounter=0;
        globalThis.grecaptcha={enterprise:{execute:async(_key,options)=>{
          if(globalThis.__fixtureCaptchaFailure)throw new Error('fixture');
          return 'fixture-captcha-'+options.action+'-'+${JSON.stringify(randomUUID())}+'-'+(++globalThis.__fixtureCaptchaCounter);
        }}};
        const original=globalThis.grecaptcha.enterprise.execute;
        globalThis.grecaptcha.enterprise.execute=(key,options)=>original(key,Object.assign({},options,{action:'extension_hijack_detected'}));
      </script>Flow fixture</body></html>`,
      });
      return;
    }
    const rpcId = url.searchParams.get('rpcids');
    const body = new URLSearchParams(request.postData());
    assert.equal(body.get('at'), 'fixture-at-token');
    const envelope = JSON.parse(body.get('f.req'));
    assert.equal(envelope[0][0][0], rpcId);
    const payload = JSON.parse(envelope[0][0][1]);
    if (['maseQ', 'ogiZ0b', 'eb1hJf'].includes(rpcId)) {
      const context =
        rpcId === 'maseQ'
          ? payload[0]
          : rpcId === 'ogiZ0b'
            ? payload[3]
            : payload[1];
      assert.equal(context[5], projectId);
      const token = context[10][0];
      const action =
        rpcId === 'eb1hJf' ? 'VIDEO_GENERATION' : 'IMAGE_GENERATION';
      assert.ok(token.startsWith(`fixture-captcha-${action}-`));
      assert.equal(captchaTokens.has(token), false);
      captchaTokens.add(token);
    }
    let result;
    if (rpcId === 'jHPbke') {
      projectId = randomUUID();
      projectsCreated++;
      result = [projectId, [payload[1][1][0]]];
    } else if (rpcId === 'maseQ') {
      uploadCount++;
      assert.equal(payload[1], referenceBytes.toString('base64'));
      assert.equal(payload[2], 'image/png');
      result = [[referenceId, projectId]];
    } else if (rpcId === 'ogiZ0b') {
      imageCount++;
      imageId = randomUUID();
      const item = payload[1][0];
      assert.equal(item[2][0][0], referenceId);
      assert.equal(item[4], 2);
      assert.equal(item[5], expectedImageModel);
      assert.equal(
        item[8][0][0][0],
        expectedTasks[videoCount].original.imagePrompt,
      );
      assert.equal(item[7][10][0], payload[3][10][0]);
      result = [
        [
          `https://flow-content.google/image/${imageId}?fixture-cdn-token=image`,
        ],
      ];
    } else if (rpcId === 'eb1hJf') {
      videoCount++;
      const item = payload[0][0];
      assert.equal(
        item[0][2][0][0][0],
        expectedTasks[videoCount - 1].original.videoPrompt,
      );
      assert.equal(item[1], expectedVideoModel);
      assert.equal(item.length, expectedVideoModel.endsWith('_360p') ? 10 : 6);
      if (expectedVideoModel.endsWith('_360p'))
        assert.deepEqual(item.slice(6), [null, null, null, [4]]);
      assert.equal(item[2], 1);
      assert.equal(item[4][1], imageId);
      result = [null, 50, [[operationId, projectId, randomUUID(), 'BUSY']]];
    } else if (rpcId === 'jwpduf') {
      assert.equal(payload[2][0][0], operationId);
      result = [null, 50, [[operationId, projectId, randomUUID(), 'BUSY']]];
    } else if (rpcId === 'Zzl0ze') {
      assert.equal(payload[0], `projects/${projectId}`);
      result = [
        [
          operationId,
          'folder',
          null,
          ['Video', [1, 0], true, null, videoId, operationId, true],
          projectId,
        ],
      ];
    } else if (rpcId === 'as29s') {
      mediaCount++;
      assert.equal(payload[0], videoId);
      result = [
        [
          mediaCount === 1
            ? `https://flow-content.google/image/${videoId}`
            : `https://flow-content.google/video/${videoId}?fixture-cdn-token=video${mode === 'html-download' ? '&html=1' : ''}`,
        ],
      ];
    } else assert.fail(`Unexpected fixture RPC ${rpcId}`);
    const response = JSON.stringify([
      ['wrb.fr', rpcId, JSON.stringify(result)],
    ]);
    await route.fulfill({
      contentType: 'application/json',
      body: `)]}'\n\n${response.length}\n${response}\n`,
    });
  });
  const flow = await browser.newPage();
  const orders = await browser.newPage();
  const panelUrl = panel.url();
  let api = await localClient(base);
  try {
    await flow.goto(`https://flow.google.com/project/${projectId}`);
    await orders.goto(`${base}/orders`);
    await orders
      .getByLabel('Nome do pedido', { exact: true })
      .fill('Pedido navegador');
    await orders
      .getByLabel('Nome do produto', { exact: true })
      .fill('Produto fixture');
    await orders
      .getByLabel('Informações do produto e orientações')
      .fill('Material de teste sintético.');
    await orders.getByLabel('Imagem de referência para o Flow').setInputFiles({
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
    assert.equal(imageCount, 0);
    assert.equal(videoCount, 0);
    assert.equal(projectsCreated, 0);
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
    assert.equal(imageCount, 0);
    assert.equal(videoCount, 0);
    expectedTasks = prepared.preparation.manifests[0].tasks;
    assert.equal(
      expectedTasks[1].reuseImageFrom,
      singleImage ? expectedTasks[0].id : undefined,
    );
    assert.equal(
      expectedTasks[2].reuseImageFrom,
      expectedTasks[singleImage ? 0 : 1].id,
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
    await eventually(
      async () => (await api('/manage/orders/1')).order.state === 'completed',
      120000,
    );
    assert.equal(projectsCreated, 1);
    assert.equal(imageCount, singleImage ? 1 : 2);
    assert.equal(uploadCount, singleImage ? 1 : 2);
    assert.equal(videoCount, 3);
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
    for (const download of downloads) {
      assert.ok(download.filename.includes('/.cache/browser-'));
      folders.add(download.filename.replace(/[^/]+$/, ''));
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
    await panel.locator('#connection-options summary').click();
    await panel.locator('#diagnostics summary').click();
    await eventually(
      async () =>
        (await panel.locator('#queue-tasks').textContent()).includes(
          'Concluída',
        ),
      40000,
    );
    assert.equal(imageCount, singleImage ? 1 : 2);
    assert.equal(videoCount, 3);
    console.log(
      `Chrome isolado (${format}): pedido pelo painel, checkout, preparação, autorização, ${singleImage ? 'uma imagem compartilhada pelos três takes' : 'duas imagens com CTA reutilizado'}, três MP4s, painel fechado, reinício e limpeza passaram com fixtures locais.`,
    );
  } finally {
    await orders.close().catch(() => {});
    media.releaseDownload();
    await flow.close().catch(() => {});
    await browser.unroute('https://flow.google.com/**').catch(() => {});
  }
}
