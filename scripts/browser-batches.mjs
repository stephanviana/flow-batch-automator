import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { URLSearchParams } from 'node:url';

export async function prepareBatch(
  panel,
  eventually,
  name,
  mode = 'new-project',
) {
  await panel.locator('#batch-new').evaluate((element) => {
    element.open = true;
  });
  await panel.locator('[name="batchName"]').fill(name);
  await panel.locator('[name="batchMode"]').selectOption(mode);
  await panel.locator('#batch-prepare').click();
  await eventually(
    async () => !(await panel.locator('#batch-prepare').isDisabled()),
    30000,
  );
  return panel.evaluate(() => chrome.runtime.sendMessage({ type: 'status' }));
}

export async function validateBatches({
  browser,
  panel,
  eventually,
  stopServer,
  startServer,
}) {
  const created = [];
  let unknown = false;
  let rejectSettlement = false;
  const localApi = async (route) => {
    const request = route.request();
    const body = request.method() === 'POST' ? request.postDataJSON() : null;
    if (
      rejectSettlement &&
      body?.action === 'settle' &&
      body.outcome === 'ready'
    )
      await route.fulfill({ status: 503, body: 'fixture lost confirmation' });
    else await route.continue();
  };
  const fixture = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.endsWith('/batchexecute')) {
      await route.fulfill({
        contentType: 'text/html',
        body: `<html lang="pt-BR"><body><script>
        globalThis.WIZ_global_data={SNlM0e:'fixture-project-token'};
        </script>Project fixture</body></html>`,
      });
      return;
    }
    const rpcId = url.searchParams.get('rpcids');
    const envelope = JSON.parse(
      new URLSearchParams(request.postData()).get('f.req'),
    );
    const payload = JSON.parse(envelope[0][0][1]);
    let result;
    if (rpcId === 'jHPbke') {
      assert.equal(payload[0], 'projects/*');
      assert.deepEqual(payload[2], [null, 22]);
      assert.equal(payload[1][0], null);
      const project = { id: randomUUID(), title: payload[1][1][0] };
      created.push(project);
      result = [project.id, [project.title]];
      if (unknown) {
        await route.fulfill({
          status: 503,
          body: 'fixture interrupted response',
        });
        return;
      }
    } else {
      assert.equal(
        rpcId,
        'Zzl0ze',
        'Project management must never generate media',
      );
      assert.ok(
        created.some((project) => `projects/${project.id}` === payload[0]),
      );
      result = [[]];
    }
    const response = JSON.stringify([
      ['wrb.fr', rpcId, JSON.stringify(result)],
    ]);
    await route.fulfill({
      contentType: 'application/json',
      body: `)]}'\n\n${response.length}\n${response}\n`,
    });
  };
  await browser.route('https://flow.google.com/**', fixture);
  await browser.route('http://127.0.0.1:4319/api/batches', localApi);
  const status = () =>
    panel.evaluate(() => chrome.runtime.sendMessage({ type: 'status' }));
  const open = async (batch) => {
    await panel.locator('#batch-select').selectOption(batch.id);
    await panel.locator('#batch-open').click();
    await eventually(
      async () => !(await panel.locator('#batch-open').isDisabled()),
    );
    return status();
  };
  try {
    const flow = await browser.newPage();
    await flow.goto('https://flow.google.com/');
    if (!(await panel.locator('[data-action="queue-pause"]').isDisabled()))
      await panel.locator('[data-action="queue-pause"]').click();
    let reply = await prepareBatch(panel, eventually, 'Campanha A');
    assert.equal(reply.operationError, null);
    const batchA = reply.batches.find(
      (batch) => batch.id === reply.activeBatchId,
    );
    assert.equal(batchA.projectId, created[0].id);
    assert.equal(created[0].title, 'Campanha A');
    reply = await prepareBatch(panel, eventually, 'Campanha B');
    const batchB = reply.batches.find(
      (batch) => batch.id === reply.activeBatchId,
    );
    assert.equal(batchB.projectId, created[1].id);
    assert.notEqual(batchA.projectId, batchB.projectId);
    assert.equal(created.length, 2);
    reply = await open(batchA);
    assert.equal(reply.activeBatchId, batchA.id);
    assert.equal(reply.flow.projectId, batchA.projectId);
    assert.equal(created.length, 2);
    const tab = browser
      .pages()
      .find((page) => page.url().endsWith(`/project/${batchA.projectId}`));
    assert.ok(tab);
    await tab.goto('https://flow.google.com/');
    reply = await open(batchA);
    assert.equal(reply.flow.projectId, batchA.projectId);
    assert.equal(
      created.length,
      2,
      'Reusing the Flow tab must not cause another project creation',
    );
    await panel.reload();
    await eventually(
      async () =>
        (await panel.locator('#batch-select').inputValue()) === batchA.id,
    );
    reply = await prepareBatch(
      panel,
      eventually,
      'Lote em projeto existente',
      'existing-project',
    );
    const existing = reply.batches.find(
      (batch) => batch.id === reply.activeBatchId,
    );
    assert.equal(existing.projectId, batchA.projectId);
    assert.equal(created.length, 2);

    rejectSettlement = true;
    reply = await prepareBatch(
      panel,
      eventually,
      'Confirmação local interrompida',
    );
    const recoverable = reply.batches.find(
      (batch) => batch.id === reply.activeBatchId,
    );
    assert.equal(recoverable.status, 'creating');
    assert.equal(created.length, 3);
    rejectSettlement = false;
    reply = await open(recoverable);
    assert.equal(
      reply.batches.find((batch) => batch.id === recoverable.id).projectId,
      created[2].id,
    );
    assert.equal(
      created.length,
      3,
      'A stored creation receipt must recover without creating another project',
    );

    unknown = true;
    reply = await prepareBatch(panel, eventually, 'Criação interrompida');
    const interrupted = reply.batches.find(
      (batch) => batch.id === reply.activeBatchId,
    );
    assert.equal(interrupted.status, 'uncertain');
    assert.equal(created.length, 4);
    await open(interrupted);
    assert.equal(created.length, 4, 'Unknown creation must never be repeated');
    await stopServer();
    await startServer();
    await eventually(
      async () => (await status()).state.phase === 'connected',
      40000,
    );
    reply = await open(interrupted);
    assert.equal(
      reply.batches.find((batch) => batch.id === interrupted.id).status,
      'uncertain',
    );
    assert.equal(created.length, 4);
    await flow.goto(`https://flow.google.com/project/${created[3].id}`);
    await panel.locator('[data-action="flow-inspect"]').click();
    await eventually(
      async () => (await status()).flow?.projectId === created[3].id,
    );
    await panel.locator('#batch-reviewed').check();
    await panel.locator('#batch-attach').click();
    await eventually(
      async () => await panel.locator('#batch-review').isHidden(),
    );
    reply = await status();
    assert.equal(
      reply.batches.find((batch) => batch.id === interrupted.id).projectId,
      created[3].id,
    );
    assert.equal(created.length, 4);
    assert.equal(
      browser
        .pages()
        .filter((page) => page.url().startsWith('https://flow.google.com/'))
        .length,
      1,
    );
    console.log(
      'Batch projects in one real Chrome tab against local fixtures: creation, distinct projects, existing project, reopen/reload persistence, stored receipt recovery without duplicate creation and reviewed recovery after uncertain creation/restart passed. No Google request or paid generation.',
    );
  } catch (error) {
    const tabs = await browser.serviceWorkers()[0].evaluate(async () =>
      (await chrome.tabs.query({ url: 'https://flow.google.com/*' })).map(
        (tab) => ({
          id: tab.id,
          status: tab.status,
          path: tab.url ? new URL(tab.url).pathname : null,
        }),
      ),
    );
    console.error(
      'Synthetic project tabs:',
      tabs,
      'Created fixture projects:',
      created.length,
    );
    throw error;
  } finally {
    for (const page of browser.pages())
      if (page.url().startsWith('https://flow.google.com/')) await page.close();
    await browser.unroute('https://flow.google.com/**', fixture);
    await browser.unroute('http://127.0.0.1:4319/api/batches', localApi);
  }
}
