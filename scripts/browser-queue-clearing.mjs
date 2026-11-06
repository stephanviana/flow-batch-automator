import assert from 'node:assert/strict';
import { sendPanelRequest } from './browser-panel-design.mjs';

export async function validateCompletedClearing(panel, eventually) {
  const before = await sendPanelRequest(panel, 'status');
  await panel.getByRole('button', { name: 'Limpar fila', exact: true }).click();
  await eventually(async () => await panel.locator('#queue-empty').isVisible());
  assert.equal(await panel.locator('#queue-tasks > li').count(), 0);
  assert.equal(await panel.locator('#task-history').isVisible(), false);
  assert.deepEqual(
    (await sendPanelRequest(panel, 'status')).queue,
    before.queue,
  );
  assert.equal(await panel.locator('#queue-clear').isDisabled(), true);
  const storage = await panel.evaluate(() => chrome.storage.local.get(null));
  assert.equal('clearedQueueTasks' in storage, false);
  await panel.reload();
  await panel
    .getByRole('tab', { name: 'Fila e gerações', exact: true })
    .click();
  await eventually(
    async () =>
      (await panel.locator('#queue-tasks > li').count()) ===
      before.queue.tasks.length,
  );
  await panel
    .locator('#queue-tasks > li')
    .first()
    .getByRole('button', { name: 'Ver histórico' })
    .click();
  await eventually(
    async () => await panel.locator('#task-history').isVisible(),
  );
  assert.deepEqual(
    (await sendPanelRequest(panel, 'status')).inspection.events,
    before.inspection.events,
  );
  console.log(
    'Queue clearing: completed takes removed only from the current view, no preference saved, history and server state preserved.',
  );
}

export async function validateClearingDuringReview(panel, eventually) {
  const before = await sendPanelRequest(panel, 'status');
  const remaining = before.queue.tasks.filter(
    (task) => task.state !== 'completed',
  );
  await panel.getByRole('button', { name: 'Limpar fila', exact: true }).click();
  await eventually(
    async () =>
      (await panel.locator('#queue-tasks > li').count()) === remaining.length,
  );
  assert.deepEqual(
    await panel
      .locator('#queue-tasks > li')
      .evaluateAll((rows) => rows.map((row) => row.dataset.taskId)),
    remaining.map((task) => task.id),
  );
  assert.equal(
    await panel.locator('#queue-tasks [data-state="uncertain"]').count(),
    1,
  );
  assert.equal(
    await panel.locator('[data-action="queue-start"]').isDisabled(),
    true,
  );
  assert.deepEqual(
    (await sendPanelRequest(panel, 'status')).queue,
    before.queue,
  );
  await panel.reload();
  await panel
    .getByRole('tab', { name: 'Fila e gerações', exact: true })
    .click();
  await eventually(
    async () =>
      (await panel.locator('#queue-tasks > li').count()) ===
      before.queue.tasks.length,
  );
}
