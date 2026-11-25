import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkout, localClient } from './orders.mjs';

export async function prepareWorkerOrder(
  context,
  base,
  home,
  reference,
  eventually,
) {
  const page = await context.newPage();
  try {
    await page.goto(`${base}/orders`);
    await page
      .getByLabel('Nome do pedido', { exact: true })
      .fill('Pedido nativo fixture');
    await page
      .getByLabel('Nome do produto', { exact: true })
      .fill('Produto fixture');
    await page
      .getByLabel('Informações do produto e orientações')
      .fill('Material sintético.');
    await page.getByLabel('Imagens de referência para o Flow').setInputFiles({
      name: 'product.png',
      mimeType: 'image/png',
      buffer: reference,
    });
    await page.getByLabel('Variações', { exact: true }).fill('1');
    await page.getByLabel('Formato', { exact: true }).selectOption('seller');
    await page
      .getByRole('button', { name: 'Salvar pedido', exact: true })
      .click();
    await eventually(async () =>
      (await page.locator('#status').textContent()).includes('Pedido 1 salvo'),
    );
    const api = await localClient(base);
    const { order, variationPlan } = await api('/manage/orders/1');
    const directory = join(home, 'checkout');
    await checkout(api, 1, 'native-worker-fixture', directory);
    const preparation = JSON.parse(
      await readFile(join(directory, 'preparacao.json'), 'utf8'),
    );
    assert.equal(
      'presenterImage' in preparation.products[0].variations[0],
      false,
    );
    const variation = variationPlan[0];
    preparation.products[0].variations = [
      {
        id: variation.id,
        name: variation.name,
        format: variation.format,
        hookImage: {
          prompt: 'Produto de fixture.',
          negative_prompt: 'Sem texto.',
          aspect_ratio: '9:16',
        },
        copy: {
          hook: 'Gancho de fixture.',
          body: 'Corpo de fixture.',
          cta: 'CTA de fixture.',
        },
      },
    ];
    const prepared = await api(
      `/manage/orders/${order.id}/prepare`,
      preparation,
    );
    assert.equal(prepared.state, 'prepared');
    return { api, order, manifest: prepared.preparation.manifests[0] };
  } finally {
    await page.close();
  }
}
