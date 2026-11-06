import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { sendPanelRequest } from './browser-panel-design.mjs';

function blockSyntheticOrder(directory) {
  const database = new DatabaseSync(resolve(directory, 'state.sqlite'));
  try {
    const dispatch = database
      .prepare(
        'SELECT dispatch_id,batch_id FROM order_dispatches ORDER BY rowid LIMIT 1',
      )
      .get();
    assert.ok(dispatch);
    const task = database
      .prepare(
        'SELECT id FROM queue_tasks WHERE batch_id=? ORDER BY sequence LIMIT 1',
      )
      .get(dispatch.batch_id);
    assert.ok(task);
    const message =
      'Falha sintética registrada para validar o acesso à revisão.';
    database
      .prepare(
        "UPDATE dispatch_commands SET state='blocked',message=?,failure=? WHERE id=?",
      )
      .run(
        message,
        JSON.stringify({
          stage: 'project-creation',
          code: 'fixture_project_unknown',
          sent: true,
        }),
        dispatch.dispatch_id,
      );
    database
      .prepare(
        "UPDATE queue_tasks SET state='uncertain',revision=revision+1,last_error=? WHERE id=?",
      )
      .run(
        JSON.stringify({
          code: 'fixture_interrupted',
          message: 'Conexão interrompida na validação de revisão.',
          retryable: false,
          notSubmitted: false,
        }),
        task.id,
      );
    database.prepare('UPDATE queue_controls SET running=0').run();
    return {
      dispatchId: String(dispatch.dispatch_id),
      taskId: String(task.id),
      message,
    };
  } finally {
    database.close();
  }
}

export async function validateOrderReview({
  browser,
  panel,
  eventually,
  directory,
  base,
}) {
  const fixture = blockSyntheticOrder(directory);
  await panel
    .getByRole('tab', { name: 'Fila e gerações', exact: true })
    .click();
  await eventually(
    async () => await panel.locator('#dispatch-issues').isVisible(),
  );
  assert.match(
    await panel.locator('#dispatch-issues-list').textContent(),
    /Falha sintética/,
  );
  const opened = browser.waitForEvent('page');
  await panel
    .locator('#dispatch-issues-list')
    .getByRole('button', { name: 'Revisar pedido' })
    .click();
  const orders = await opened;
  await orders.waitForURL(`${base}/orders?dispatch=${fixture.dispatchId}`);
  await orders.locator('.order-review[open]').waitFor();
  assert.match(
    await orders.locator('.order-review-content').textContent(),
    /fixture_project_unknown/,
  );
  assert.match(
    await orders.locator('.order-review-content').textContent(),
    /takes registrados/,
  );
  assert.match(
    await orders.locator('.order-review-content').textContent(),
    /fixture_interrupted/,
  );
  assert.match(
    await orders.locator('.order-review-content').textContent(),
    /Conexão interrompida/,
  );
  const row = panel.locator(`[data-task-id="${fixture.taskId}"]`);
  await row.locator('.task-review > summary').click();
  assert.equal(
    await row.getByRole('textbox', { name: 'Nota de revisão' }).isVisible(),
    true,
  );
  assert.equal(
    await row
      .getByRole('button', { name: 'Encerrar tentativa com falha' })
      .isVisible(),
    true,
  );
  await row.getByRole('button', { name: 'Ver histórico' }).click();
  await eventually(
    async () => await panel.locator('#task-history').isVisible(),
  );
  await panel.getByRole('button', { name: 'Limpar fila', exact: true }).click();
  assert.equal(
    await row.isVisible(),
    true,
    'Clearing completed takes must retain the uncertain take',
  );
  await orders.screenshot({
    path: resolve(directory, 'order-review.png'),
    fullPage: true,
  });
  await orders.close();
  await verifyProjectLookup(browser, panel, row, fixture.taskId);
  const state = await sendPanelRequest(panel, 'status');
  assert.equal(state.queue.blockedByReview, true);
  assert.equal(
    state.queue.tasks.find((task) => task.id === fixture.taskId).state,
    'uncertain',
  );
  await verifyGroupClosure(browser, panel, row, fixture, base);
  console.log(
    'Order review: extension opens the matching diagnosis; preparation, dispatch failure and take errors are visible; project lookup reuses the Flow tab; clearing preserves unresolved work. No generation or resume request.',
  );
}

async function verifyProjectLookup(browser, panel, row, taskId) {
  const route = 'https://flow.google.com/**';
  await browser.route(route, (request) => {
    assert.equal(
      request.request().method(),
      'GET',
      'Review may only navigate to the existing project',
    );
    return request.fulfill({
      contentType: 'text/html',
      body: '<script>globalThis.WIZ_global_data={SNlM0e:"fixture",FdrFJe:"fixture",cfb2h:"fixture"}</script>Review fixture',
    });
  });
  const flow = await browser.newPage();
  try {
    await flow.goto('https://flow.google.com/project/review-fixture');
    const before = browser
      .pages()
      .filter((page) =>
        page.url().startsWith('https://flow.google.com/'),
      ).length;
    await row.getByRole('button', { name: 'Conferir projeto no Flow' }).click();
    const detail = await panel.evaluate(
      (taskId) => chrome.runtime.sendMessage({ type: 'queue-inspect', taskId }),
      taskId,
    );
    await flow.waitForURL(
      `https://flow.google.com/project/${detail.inspection.input.flow.projectId}`,
    );
    assert.equal(
      browser
        .pages()
        .filter((page) => page.url().startsWith('https://flow.google.com/'))
        .length,
      before,
    );
  } finally {
    await flow.close();
    await browser.unroute(route);
  }
}

async function verifyGroupClosure(browser, panel, row, fixture, base) {
  await row
    .getByRole('textbox', { name: 'Nota de revisão' })
    .fill(
      'Conferi o resultado sintético. Encerrar esta tentativa sem nova geração.',
    );
  await row
    .getByRole('button', { name: 'Encerrar tentativa com falha' })
    .click();
  await panel
    .locator(`[data-task-id="${fixture.taskId}"][data-state="failed"]`)
    .waitFor();
  const before = await sendPanelRequest(panel, 'status');
  const orders = await browser.newPage();
  try {
    await orders.goto(`${base}/orders?dispatch=${fixture.dispatchId}`);
    await orders.locator('.order-review[open]').waitFor();
    await orders.locator('.dispatch-close-form > summary').click();
    await orders
      .getByLabel('Motivo do encerramento')
      .fill('Manter os vídeos prontos e encerrar o grupo nesta validação.');
    await orders
      .getByRole('button', { name: 'Confirmar encerramento' })
      .click();
    assert.equal(
      await orders.locator('#orders article[data-state="blocked"]').count(),
      1,
    );
    await orders
      .getByLabel('Conferi a revisão e quero encerrar este grupo.')
      .check();
    await orders
      .getByRole('button', { name: 'Confirmar encerramento' })
      .click();
    await orders.getByText('Encerrado parcialmente', { exact: true }).waitFor();
    assert.equal(
      await orders
        .getByRole('button', { name: 'Revisar pedido', exact: true })
        .count(),
      0,
    );
    assert.deepEqual(
      (await sendPanelRequest(panel, 'status')).queue,
      before.queue,
    );
    await orders
      .getByRole('button', { name: 'Limpar da lista', exact: true })
      .click();
    assert.equal(await orders.locator('#orders article').count(), 0);
    await orders.reload();
    await orders.getByText('Encerrado parcialmente', { exact: true }).waitFor();
    assert.equal(
      (await sendPanelRequest(panel, 'status')).dispatchIssues.length,
      0,
    );
    console.log(
      'Review outcome: explicit group closure preserves completed videos and task history, removes the review block and allows temporary order list clearing. No generation was resumed.',
    );
  } finally {
    await orders.close();
  }
}
