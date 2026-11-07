import assert from 'node:assert/strict';
import { validateCompletedClearing } from './browser-queue-clearing.mjs';
import {
  sendPanelRequest,
  validateQueueRows,
} from './browser-panel-design.mjs';

export async function validateQueue({
  popup,
  eventually,
  stopServer,
  startServer,
}) {
  await popup
    .getByRole('tab', { name: 'Fila e gerações', exact: true })
    .click();
  const tasks = popup.locator('#queue-tasks > li');
  await sendPanelRequest(popup, 'enqueue-demo');
  await eventually(async () => (await tasks.count()) === 3);
  assert.equal(
    await popup.locator('#queue-tasks [data-state="queued"]').count(),
    3,
  );
  await validateQueueRows(popup);
  // A slow acknowledgement must not leave the start button visually silent.
  await popup.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (request) => {
      if (request.type === 'queue-start') {
        chrome.runtime.sendMessage = original;
        await new Promise((resolve) => globalThis.setTimeout(resolve, 900));
      }
      return original(request);
    };
  });
  await popup
    .getByRole('button', { name: 'Processar fila', exact: true })
    .click();
  assert.equal(
    await popup.locator('#queue-activity-title').textContent(),
    'Iniciando fila…',
  );
  assert.equal(
    await popup.locator('[data-action="queue-start"]').isDisabled(),
    true,
  );
  assert.equal(
    await popup.locator('[data-action="queue-start"]').textContent(),
    'Iniciando fila…',
  );
  assert.equal(
    await popup.locator('#queue-activity').getAttribute('data-busy'),
    'true',
  );
  await eventually(
    async () =>
      (await popup.locator('#queue-tasks [data-state="completed"]').count()) ===
      3,
    25000,
  );
  for (const row of await tasks.all())
    assert.equal(await row.getAttribute('data-attempt-count'), '1');
  await eventually(
    async () =>
      (await popup.locator('#queue-activity-title').textContent()) ===
      'Simulação concluída',
  );
  assert.equal(
    await popup.locator('#queue-activity').getAttribute('data-tone'),
    'success',
  );
  await tasks.first().getByRole('button', { name: 'Ver histórico' }).click();
  await eventually(
    async () => (await popup.locator('#queue-history li').count()) === 6,
  );

  await sendPanelRequest(popup, 'enqueue-retry-demo');
  await eventually(
    async () =>
      (await popup.locator('#queue-tasks [data-state="completed"]').count()) ===
      4,
    15000,
  );
  assert.equal(
    await popup.locator('#queue-tasks [data-attempt-count="2"]').count(),
    1,
  );
  await popup.getByRole('button', { name: 'Pausar fila', exact: true }).click();
  await sendPanelRequest(popup, 'enqueue-demo');
  await eventually(
    async () =>
      (await popup.locator('#queue-tasks [data-state="queued"]').count()) === 3,
  );
  await popup
    .getByRole('button', { name: 'Processar fila', exact: true })
    .click();
  await eventually(
    async () =>
      (await popup
        .locator('#queue-tasks [data-state="generating"]')
        .count()) === 1,
  );
  await stopServer();
  await startServer();
  await eventually(
    async () =>
      (await popup.locator('#queue-tasks [data-state="uncertain"]').count()) ===
      1,
    40000,
  );
  assert.equal(await tasks.count(), 7);
  assert.equal(
    await popup.locator('#queue-activity').getAttribute('data-busy'),
    'false',
  );
  assert.ok(
    (await popup.locator('#queue-activity-title').textContent()).includes(
      'revisão',
    ),
  );
  const completedBeforeReview = await popup
    .locator('#queue-tasks [data-state="completed"]')
    .count();
  const pendingBeforeReview = 6 - completedBeforeReview;
  assert.ok(pendingBeforeReview >= 0 && pendingBeforeReview <= 2);
  assert.equal(
    await popup.locator('#queue-tasks [data-state="queued"]').count(),
    pendingBeforeReview,
  );
  const activeId = await popup
    .locator('#queue-tasks [data-state="uncertain"]')
    .getAttribute('data-task-id');
  assert.equal(
    await popup
      .locator('#queue-tasks [data-state="uncertain"]')
      .getAttribute('data-attempt-count'),
    '1',
  );
  assert.equal(
    await popup
      .getByRole('button', { name: 'Processar fila', exact: true })
      .isDisabled(),
    true,
  );
  await popup
    .locator('#queue-tasks [data-state="uncertain"]')
    .getByRole('button', { name: 'Revisar: confirmar sem envio externo' })
    .click();
  await eventually(
    async () =>
      (await popup.locator('#queue-tasks [data-state="failed"]').count()) === 1,
  );
  await popup
    .locator('#queue-tasks [data-state="failed"]')
    .getByRole('button', { name: 'Tentar novamente' })
    .click();
  await eventually(
    async () =>
      (await popup.locator('#queue-tasks [data-state="queued"]').count()) ===
      pendingBeforeReview + 1,
  );
  assert.match(await popup.locator('#queue-status').textContent(), /pausada/);
  await popup
    .getByRole('button', { name: 'Processar fila', exact: true })
    .click();
  await eventually(
    async () =>
      (await popup.locator('#queue-tasks [data-state="completed"]').count()) ===
      7,
    25000,
  );
  assert.equal(
    await popup
      .locator(`[data-task-id="${activeId}"]`)
      .getAttribute('data-attempt-count'),
    '2',
  );
  assert.equal(
    await popup.locator('#queue-tasks [data-attempt-count="2"]').count(),
    2,
  );
  await popup
    .locator(`[data-task-id="${activeId}"]`)
    .getByRole('button', { name: 'Ver histórico' })
    .click();
  await eventually(async () =>
    (await popup.locator('#queue-history').textContent()).includes('Incerta'),
  );
  await validateCompletedClearing(popup, eventually);
  console.log(
    'Queue in real Chrome: ordered takes, persisted history, safe retry, server restart, uncertain-result barrier, explicit review and a fresh retry passed.',
  );
}
