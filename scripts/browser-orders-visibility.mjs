import assert from 'node:assert/strict';
import { clickOrdersInSidePanel, openSidePanel } from './browser-sidepanel.mjs';

async function expectFullWidth(page, fullWidth) {
  await page.waitForFunction(
    (width) => globalThis.innerWidth === width,
    fullWidth,
  );
}

async function openOnSource(browser, worker, source, fullWidth) {
  await source.bringToFront();
  await openSidePanel(browser, worker, source);
  await source.waitForFunction(
    (width) => globalThis.innerWidth < width,
    fullWidth,
  );
}

async function verifyReturningToOrders(browser, worker, source, fullWidth) {
  await openOnSource(browser, worker, source, fullWidth);
  const opened = browser.waitForEvent('page');
  await clickOrdersInSidePanel(browser, new URL(worker.url()).host);
  const orders = await opened;
  await orders.waitForURL('http://127.0.0.1:4319/orders');
  await expectFullWidth(orders, fullWidth);
  try {
    // Regression: reopen on another tab, then return to the existing orders tab.
    await openOnSource(browser, worker, source, fullWidth);
    await orders.bringToFront();
    await expectFullWidth(orders, fullWidth);
    await openOnSource(browser, worker, source, fullWidth);
    await orders.bringToFront();
    await expectFullWidth(orders, fullWidth);
  } finally {
    await orders.close();
  }
}

async function verifyNavigationInPlace(browser, worker, fullWidth) {
  const page = await browser.newPage();
  try {
    await page.goto('https://flow.google.com/project/visibility-fixture');
    await openOnSource(browser, worker, page, fullWidth);
    await page.goto('http://127.0.0.1:4319/orders?view=saved#orders');
    await expectFullWidth(page, fullWidth);
    await page.reload();
    await expectFullWidth(page, fullWidth);
    await page.goto('https://flow.google.com/project/visibility-fixture');
    await openOnSource(browser, worker, page, fullWidth);
    const enabled = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      return (await chrome.sidePanel.getOptions({ tabId: tab.id })).enabled;
    });
    assert.equal(enabled, true, 'Leaving orders must restore the side panel');
  } finally {
    await page.close();
  }
}

async function verifyBackgroundOrders(browser, worker, source, fullWidth) {
  await openOnSource(browser, worker, source, fullWidth);
  const opened = browser.waitForEvent('page');
  await worker.evaluate(() =>
    chrome.tabs.create({
      url: 'http://127.0.0.1:4319/orders?background=1',
      active: false,
    }),
  );
  const background = await opened;
  try {
    await background.waitForURL('http://127.0.0.1:4319/orders?background=1');
    assert.ok(
      await source.evaluate(
        (width) => globalThis.innerWidth < width,
        fullWidth,
      ),
      'Loading background orders must preserve the visible side panel',
    );
    await background.bringToFront();
    await expectFullWidth(background, fullWidth);
  } finally {
    await background.close();
  }
}

export async function validateOrdersPanelVisibility(
  browser,
  worker,
  source,
  fullWidth,
) {
  await verifyReturningToOrders(browser, worker, source, fullWidth);
  await verifyNavigationInPlace(browser, worker, fullWidth);
  await verifyBackgroundOrders(browser, worker, source, fullWidth);
  console.log(
    'Real side panel: revisiting orders, navigation/reload, restored availability and background tabs passed.',
  );
}
