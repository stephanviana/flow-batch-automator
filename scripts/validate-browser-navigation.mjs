import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { clickOrdersInSidePanel } from './browser-sidepanel.mjs';

const directory = resolve('.cache', `browser-navigation-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const browser = await chromium.launchPersistentContext(
  resolve(directory, 'profile'),
  {
    channel: 'chromium',
    headless: true,
    viewport: null,
    args: [
      '--window-size=1440,1000',
      `--disable-extensions-except=${resolve('packages/extension/dist')}`,
      `--load-extension=${resolve('packages/extension/dist')}`,
    ],
  },
);
browser.setDefaultTimeout(15000);

async function activeTab(worker) {
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tabs = await chrome.tabs.query({ windowId: tab.windowId });
    const panel = await chrome.sidePanel.getOptions({ tabId: tab.id });
    return {
      id: tab.id,
      index: tab.index,
      windowId: tab.windowId,
      url: tab.url,
      count: tabs.length,
      panelEnabled: panel.enabled,
    };
  });
}

async function openSidePanel(worker, source) {
  const launcher = await browser.newPage();
  await launcher.goto(
    `chrome-extension://${new URL(worker.url()).host}/sidepanel.html`,
  );
  await launcher.evaluate(() => {
    const open = document.createElement('button');
    open.id = 'open-real-panel';
    open.textContent = 'Open real side panel';
    open.onclick = async () => {
      const window = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: window.id });
    };
    document.body.append(open);
  });
  await source.bringToFront();
  await launcher.locator('#open-real-panel').click();
  await launcher.waitForFunction(
    async () =>
      (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }))
        .length === 1,
  );
  await launcher.close();
}

async function verifyNavigation(worker, source, fullWidth) {
  await openSidePanel(worker, source);
  await source.bringToFront();
  await source.waitForFunction(
    (width) => globalThis.innerWidth < width,
    fullWidth,
  );
  const before = await activeTab(worker);
  const sourceUrl = source.url();
  const opened = browser.waitForEvent('page');
  await clickOrdersInSidePanel(browser, new URL(worker.url()).host);
  const orders = await opened;
  await orders.waitForURL('http://127.0.0.1:4319/orders');
  // A visible side panel reduces the webpage viewport. The new tab must use
  // the full original width, not just report the expected tabs.create index.
  await orders.waitForFunction(
    (width) => globalThis.innerWidth === width,
    fullWidth,
  );
  const after = await activeTab(worker);
  assert.notEqual(after.id, before.id);
  assert.equal(after.windowId, before.windowId);
  assert.equal(after.index, before.index + 1);
  assert.equal(after.count, before.count + 1);
  assert.equal(after.url, 'http://127.0.0.1:4319/orders');
  assert.equal(after.panelEnabled, false);
  const defaults = await worker.evaluate(() => chrome.sidePanel.getOptions({}));
  assert.equal(defaults.enabled, true, 'The extension must remain available');
  assert.equal(source.url(), sourceUrl);
  await orders.screenshot({
    path: resolve(directory, `orders-${before.index}.png`),
  });
  await orders.close();
}

try {
  await browser.route('http://127.0.0.1:4319/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Pedidos fixture</h1>',
    }),
  );
  let [worker] = browser.serviceWorkers();
  worker ??= await browser.waitForEvent('serviceworker');
  const source = await browser.newPage();
  await source.goto('data:text/html,<h1>Aba original</h1>');
  const fullWidth = await source.evaluate(() => globalThis.innerWidth);
  const neighbor = await browser.newPage();
  await neighbor.goto('data:text/html,<h1>Aba da direita</h1>');
  // Insertion between existing tabs and opening from the last tab must both
  // preserve the original page and hide the real Chrome side panel.
  await verifyNavigation(worker, source, fullWidth);
  await verifyNavigation(worker, neighbor, fullWidth);
  // Exercise the compatibility path without the Chrome 141+ close API.
  await worker.evaluate(() => {
    chrome.sidePanel.close = undefined;
  });
  await verifyNavigation(worker, source, fullWidth);
  console.log(
    'Real Chrome side panel: orders open in one independent tab immediately to the right, at full width with the side panel disabled; original tabs remain intact.',
  );
  console.log(`Isolated evidence: ${directory}`);
} finally {
  await browser.close();
}
