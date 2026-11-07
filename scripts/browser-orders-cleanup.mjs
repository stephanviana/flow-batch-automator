import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localClient } from './orders.mjs';

export async function validateOrdersCleanup(page, base) {
  const api = await localClient(base);
  const { orders } = await api('/manage/orders');
  const before = (await api(`/manage/orders/${orders[0].number}`)).order;
  await page
    .getByLabel('Nome do pedido', { exact: true })
    .fill('Rascunho preservado durante a limpeza');
  const clear = page.waitForResponse(
    (response) =>
      response.url().endsWith('/manage/orders/clear') &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Limpar da lista', exact: true })
    .click();
  assert.equal((await clear).status(), 200);
  await page
    .getByText('Nenhum pedido salvo. O próximo pedido começa em #1.', {
      exact: true,
    })
    .waitFor();
  assert.equal(await page.locator('#orders article').count(), 0);
  assert.equal(
    await page.getByLabel('Nome do pedido', { exact: true }).inputValue(),
    'Rascunho preservado durante a limpeza',
  );
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await page.reload();
  await page
    .getByText('Nenhum pedido salvo. O próximo pedido começa em #1.', {
      exact: true,
    })
    .waitFor();
  assert.deepEqual((await api('/manage/orders')).orders, []);
  const archived = (await api(`/manage/orders/id/${before.id}`)).order;
  assert.ok(archived.archivedAt);
  assert.deepEqual({ ...archived, archivedAt: null }, before);
  const next = await api('/manage/orders', {
    id: randomUUID(),
    name: 'Novo ciclo',
    products: before.products,
  });
  assert.equal(next.number, 1);
  assert.notEqual(next.id, before.id);
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await page
    .locator('#orders article[data-state="awaiting-preparation"]')
    .waitFor();
  assert.equal(await page.locator('#orders article').count(), 1);
  const bulk = page.waitForResponse(
    (response) =>
      response.url().endsWith('/manage/orders/clear') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Limpar lista', exact: true }).click();
  assert.equal((await bulk).status(), 200);
  await page
    .getByText('Nenhum pedido salvo. O próximo pedido começa em #1.', {
      exact: true,
    })
    .waitFor();
  console.log(
    'Order clearing persists across refresh/reload, preserves draft and immutable records, and resets the next number to 1.',
  );
}
