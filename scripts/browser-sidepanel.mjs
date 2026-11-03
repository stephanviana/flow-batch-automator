import assert from 'node:assert/strict';
import { clearTimeout, setTimeout } from 'node:timers';

function clickLink(connection, sessionId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Side panel click timed out')),
      15000,
    );
    connection.on('Target.receivedMessageFromTarget', (event) => {
      if (event.sessionId !== sessionId) return;
      const message = JSON.parse(event.message);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      if (message.error || message.result?.exceptionDetails)
        reject(new Error('Could not click the real side panel link'));
      else resolve();
    });
    void connection
      .send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: 'document.querySelector("#open-orders").click()',
            userGesture: true,
          },
        }),
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

// Playwright does not expose Chrome side panel targets as ordinary pages.
export async function clickOrdersInSidePanel(browser, extensionId) {
  const connection = await browser.browser().newBrowserCDPSession();
  try {
    const { targetInfos } = await connection.send('Target.getTargets');
    const panels = targetInfos.filter(
      (target) =>
        target.url === `chrome-extension://${extensionId}/sidepanel.html`,
    );
    assert.equal(panels.length, 1, 'Only the real side panel should be open');
    const { sessionId } = await connection.send('Target.attachToTarget', {
      targetId: panels[0].targetId,
      flatten: false,
    });
    await clickLink(connection, sessionId);
  } finally {
    await connection.detach();
  }
}

export async function openSidePanel(browser, worker, source) {
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
