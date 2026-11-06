import assert from 'node:assert/strict';
import { URLSearchParams } from 'node:url';

// Runs the installed extension's real MAIN-world injection against intercepted
// HTTPS fixture pages. Never connects to Google or consumes credits.
export async function validateFlow({ browser, panel, eventually }) {
  await panel.getByRole('tab', { name: 'Início', exact: true }).click();
  const worker = browser.serviceWorkers()[0];
  const configuration = await worker.evaluate(async () => ({
    manifest: chrome.runtime.getManifest(),
    behavior: await chrome.sidePanel.getPanelBehavior(),
    options: await chrome.sidePanel.getOptions({}),
  }));
  assert.equal(
    configuration.manifest.side_panel.default_path,
    'sidepanel.html',
  );
  assert.equal(configuration.manifest.action.default_popup, undefined);
  assert.equal(configuration.behavior.openPanelOnActionClick, true);
  assert.equal(configuration.options.path, 'sidepanel.html');
  const inspect = async (phase, message) => {
    await panel.locator('[data-action="flow-inspect"]').click();
    await eventually(
      async () =>
        (await panel.locator('#flow-status').getAttribute('data-phase')) ===
          phase &&
        (await panel.locator('#flow-status').textContent()).includes(message),
    );
  };
  await inspect('no-tab', 'Abra o Google Flow');
  let rpcCount = 0;
  let responseMode = 'success';
  await browser.route('https://flow.google.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.endsWith('/batchexecute')) {
      await route.fulfill({
        contentType: 'text/html',
        body: '<html lang="pt-BR"><body>Flow fixture</body></html>',
      });
      return;
    }
    rpcCount++;
    assert.equal(url.searchParams.get('rpcids'), 'Zzl0ze');
    assert.equal(url.searchParams.get('source-path'), '/project/test-project');
    assert.equal(url.searchParams.get('hl'), 'pt');
    assert.equal(request.method(), 'POST');
    const body = new URLSearchParams(request.postData());
    assert.equal(body.get('at'), 'fixture-page-token');
    assert.deepEqual(JSON.parse(body.get('f.req')), [
      [
        [
          'Zzl0ze',
          '["projects/test-project",null,null,null,[1]]',
          null,
          'generic',
        ],
      ],
    ]);
    const envelope = JSON.stringify([
      [
        'wrb.fr',
        'Zzl0ze',
        responseMode === 'rpc-error' ? null : '[[]]',
        null,
        null,
        [7],
      ],
    ]);
    await route.fulfill({
      status: responseMode === 'http-error' ? 403 : 200,
      contentType: 'application/json',
      body:
        responseMode === 'invalid'
          ? '<html>Sign in</html>'
          : `)]}'\n\n${envelope.length}\n${envelope}\n`,
    });
  });
  const flow = await browser.newPage();
  try {
    await flow.goto('https://flow.google.com/project/test-project');
    await inspect('not-ready', 'Entre no Flow');
    assert.equal(rpcCount, 0);
    await flow.evaluate(() => {
      globalThis.WIZ_global_data = {
        SNlM0e: 'fixture-page-token',
        FdrFJe: 'fixture-session',
        cfb2h: 'fixture-build',
      };
    });
    await inspect('ready', 'Sessão verificada');
    assert.equal(
      await panel.locator('#flow-project').textContent(),
      'Projeto: test-project',
    );
    assert.equal(rpcCount, 1);
    const snapshot = await panel.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'status' }),
    );
    assert.equal(
      JSON.stringify(snapshot).includes('fixture-page-token'),
      false,
    );
    assert.equal(JSON.stringify(snapshot).includes('fixture-session'), false);
    const stored = await worker.evaluate(() => chrome.storage.local.get(null));
    assert.equal(JSON.stringify(stored).includes('fixture-page-token'), false);
    responseMode = 'rpc-error';
    await inspect('error', 'recusou a leitura');
    responseMode = 'invalid';
    await inspect('error', 'Resposta do Flow incompatível');
    responseMode = 'http-error';
    await inspect('error', 'HTTP 403');
    await flow.goto('https://flow.google.com/');
    await inspect('not-ready', 'Abra um projeto');
    await panel.setViewportSize({ width: 300, height: 900 });
    assert.equal(
      await panel.evaluate(
        () => document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
      true,
    );
    await panel.setViewportSize({ width: 380, height: 1000 });
    console.log(
      'Real Chrome extension: sidePanel configuration, MAIN-world project RPC, error handling and token isolation passed against intercepted HTTPS fixtures. No live Google request.',
    );
  } finally {
    await flow.close();
    await browser.unroute('https://flow.google.com/**');
  }
}
