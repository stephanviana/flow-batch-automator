import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localClient } from './orders.mjs';

export async function validateOrdersCleanup(page, base) {
  const api = await localClient(base);
  const { orders } = await api('/manage/orders');
  const before = await api(`/manage/orders/${orders[0].number}`);
  const writes = [];
  const observe = (request) => {
    if (request.method() !== 'GET') writes.push(request.url());
  };
  page.on('request', observe);
  try {
    await page
      .getByLabel('Nome do pedido', { exact: true })
      .fill('Rascunho preservado durante a limpeza');
    await page
      .getByRole('button', { name: 'Limpar da lista', exact: true })
      .click();
    assert.equal(await page.locator('#orders article').count(), 0);
    assert.equal(
      await page.getByLabel('Nome do pedido', { exact: true }).inputValue(),
      'Rascunho preservado durante a limpeza',
    );
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await page
      .getByText('Nenhum pedido nesta lista. Os registros foram preservados.', {
        exact: true,
      })
      .waitFor();
    assert.deepEqual(await api(`/manage/orders/${orders[0].number}`), before);
    assert.deepEqual(writes, []);
  } finally {
    page.off('request', observe);
  }
  await page.reload();
  await page.locator('#orders article[data-state="prepared"]').waitFor();
  await verifyProtectedOrders(page, orders[0]);
  console.log(
    'Order list clearing: unsent and closed orders clear temporarily; preparation, execution and review remain visible; draft, records and materials preserved.',
  );
}

async function verifyProtectedOrders(page, prepared) {
  const states = [
    'awaiting-preparation',
    'preparing',
    'blocked',
    'dispatched',
    'uncertain',
    'completed',
  ];
  const orders = [
    prepared,
    ...states.map((state, index) => ({
      ...globalThis.structuredClone(prepared),
      id: randomUUID(),
      number: index + 2,
      state,
      preparationHash:
        state === 'awaiting-preparation' ? null : prepared.preparationHash,
      lease:
        state === 'preparing'
          ? { worker: 'fixture', expiresAt: Date.now() + 60000 }
          : null,
      counts:
        state === 'uncertain'
          ? { uncertain: 1 }
          : state === 'dispatched'
            ? { generating: 1 }
            : state === 'completed'
              ? { completed: 3 }
              : {},
      dispatches: ['blocked', 'dispatched', 'uncertain', 'completed'].includes(
        state,
      )
        ? [
            {
              id: randomUUID(),
              state: state === 'blocked' ? 'blocked' : 'queued',
              message: '',
            },
          ]
        : [],
    })),
  ];
  const route = '**/manage/orders';
  await page.route(route, (request) => request.fulfill({ json: { orders } }));
  try {
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await page.locator('#orders article[data-state="blocked"]').waitFor();
    await page
      .getByRole('button', { name: 'Limpar lista', exact: true })
      .click();
    assert.deepEqual(
      await page
        .locator('#orders article')
        .evaluateAll((cards) => cards.map((card) => card.dataset.state)),
      ['preparing', 'blocked', 'dispatched', 'uncertain'],
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Limpar lista', exact: true })
        .isDisabled(),
      true,
    );
    orders[0].preparationHash = 'f'.repeat(64);
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await page.locator('#orders article[data-state="prepared"]').waitFor();
  } finally {
    await page.unroute(route);
    await page.reload();
    await page.locator('#orders article[data-state="prepared"]').waitFor();
  }
}
