import assert from 'node:assert/strict';

export async function sendPanelRequest(panel, type) {
  return panel.evaluate((type) => chrome.runtime.sendMessage({ type }), type);
}

export async function validatePanelDesign(panel, directory) {
  assert.equal(await panel.getByRole('tab').count(), 3);
  assert.equal(await panel.locator('#panel-home').isVisible(), false);
  await panel.getByRole('tab', { name: 'Início', exact: true }).click();
  assert.equal(await panel.locator('#panel-home').isVisible(), true);
  assert.equal(await panel.locator('#panel-queue').isVisible(), false);
  assert.equal(await panel.locator('#panel-settings').isVisible(), false);
  assert.equal(
    await panel.locator('#connection-badge').textContent(),
    'Conectada',
  );
  assert.equal(await panel.locator('#count-pending').textContent(), '0');
  assert.equal(
    await panel
      .locator(
        '#diagnostics, [data-action^="enqueue-"], [data-action="simulate"]',
      )
      .count(),
    0,
  );
  await panel.getByRole('tab', { name: 'Início', exact: true }).focus();
  await panel.keyboard.press('ArrowRight');
  assert.equal(
    await panel.locator('#tab-queue').getAttribute('aria-selected'),
    'true',
  );
  assert.equal(await panel.locator('#queue-empty').isVisible(), true);
  await panel.keyboard.press('End');
  assert.equal(await panel.locator('#panel-settings').isVisible(), true);
  await panel.keyboard.press('ArrowRight');
  assert.equal(await panel.locator('#panel-home').isVisible(), true);
  await panel.keyboard.press('ArrowLeft');
  assert.equal(await panel.locator('#panel-settings').isVisible(), true);
  await panel.keyboard.press('Home');
  await panel.getByRole('button', { name: 'Acompanhar fila' }).click();
  assert.equal(await panel.locator('#panel-queue').isVisible(), true);
  for (const width of [280, 320, 380, 640]) {
    await panel.setViewportSize({ width, height: 1000 });
    for (const name of ['Início', 'Fila e gerações', 'Configurações']) {
      await panel.getByRole('tab', { name, exact: true }).click();
      assert.equal(
        await panel.evaluate(
          () => document.documentElement.scrollWidth <= globalThis.innerWidth,
        ),
        true,
      );
    }
  }
  await panel.setViewportSize({ width: 380, height: 1000 });
  await panel.getByRole('tab', { name: 'Início', exact: true }).click();
  await panel.screenshot({
    path: `${directory}/dashboard.png`,
    fullPage: true,
    animations: 'disabled',
  });
  console.log(
    'Extension design: three exclusive tabs, keyboard navigation, dashboard counts, empty queue, no simulation controls and responsive layouts (280–640 px) passed.',
  );
}

export async function validateQueueRows(panel) {
  await panel
    .getByRole('tab', { name: 'Fila e gerações', exact: true })
    .click();
  for (const width of [280, 320, 380, 640]) {
    await panel.setViewportSize({ width, height: 1000 });
    const geometry = await panel
      .locator('#queue-tasks > li')
      .first()
      .evaluate((row) => {
        const title = row
          .querySelector('.task-content')
          .getBoundingClientRect();
        const state = row.querySelector('.task-state').getBoundingClientRect();
        return {
          left: title.right,
          right: state.left,
          top: Math.abs(title.top - state.top),
          width: row.clientWidth,
          height: row.clientHeight,
        };
      });
    assert.ok(
      geometry.left <= geometry.right,
      'Status stays beside the task content',
    );
    assert.ok(geometry.top < 2, 'Task and status are aligned horizontally');
    assert.ok(
      geometry.width > geometry.height,
      'Queue cards are horizontal rectangles',
    );
    assert.equal(
      await panel.evaluate(
        () => document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
      true,
    );
  }
  await panel.setViewportSize({ width: 380, height: 1000 });
}
