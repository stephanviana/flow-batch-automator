import assert from 'node:assert/strict';
import { sendPanelRequest } from './browser-panel-design.mjs';

export async function validateCompletedClearing(panel, eventually) {
  const before = await sendPanelRequest(panel, 'status');
  assert.ok(before.queue.counts.completed > 0);
  await panel.getByRole('button', { name: 'Limpar fila', exact: true }).click();
  await eventually(async () => await panel.locator('#queue-empty').isVisible());
  assert.equal(await panel.locator('#queue-tasks > li').count(), 0);
  assert.equal(await panel.locator('#task-history').isVisible(), false);
  assert.equal(await panel.locator('#queue-clear').isDisabled(), true);
  const after = await sendPanelRequest(panel, 'status');
  assert.ok(Object.values(after.queue.counts).every((count) => count === 0));
  assert.deepEqual(after.queue.tasks, []);
  await panel.reload();
  await panel
    .getByRole('tab', { name: 'Fila e gerações', exact: true })
    .click();
  await eventually(async () => await panel.locator('#queue-empty').isVisible());
  assert.equal(await panel.locator('#queue-tasks > li').count(), 0);
  assert.ok(
    Object.values((await sendPanelRequest(panel, 'status')).queue.counts).every(
      (count) => count === 0,
    ),
  );
  console.log(
    'Queue clearing: terminal takes stay cleared after reload; dashboard totals reset.',
  );
}
