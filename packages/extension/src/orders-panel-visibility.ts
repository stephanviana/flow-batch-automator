export const ordersPageUrl = 'http://127.0.0.1:4319/orders';
const ordersLocation = new URL(ordersPageUrl);

function isOrdersPage(address: string | undefined): boolean {
  if (!address) return false;
  try {
    const location = new URL(address);
    return (
      location.origin === ordersLocation.origin &&
      location.pathname === ordersLocation.pathname
    );
  } catch {
    return false;
  }
}

export async function closeSidePanel(windowId: number): Promise<void> {
  if (typeof chrome.sidePanel.close === 'function') {
    await chrome.sidePanel.close({ windowId });
    return;
  }
  // The worker can restore availability after disabling destroys the panel.
  await chrome.sidePanel.setOptions({ enabled: false });
  await chrome.sidePanel.setOptions({ enabled: true });
}

async function refreshTabVisibility(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isOrdersPage(tab.url)) {
      const options = await chrome.sidePanel.getOptions({ tabId });
      if (options.enabled === false && options.tabId === tabId)
        await chrome.sidePanel.setOptions({
          tabId,
          path: 'sidepanel.html',
          enabled: true,
        });
      return;
    }
    await chrome.sidePanel.setOptions({ tabId, enabled: false });
    // Navigation and activation can race; close only if orders are still active.
    const current = await chrome.tabs.get(tabId);
    if (current.active && isOrdersPage(current.url))
      await closeSidePanel(current.windowId);
  } catch {
    // The tab or its window may have closed during either asynchronous lookup.
  }
}

export function registerOrdersPanelVisibility(): void {
  chrome.tabs.onActivated.addListener(({ tabId }): void => {
    void refreshTabVisibility(tabId);
  });
  chrome.tabs.onUpdated.addListener((tabId, changes): void => {
    if (changes.url || changes.status === 'complete')
      void refreshTabVisibility(tabId);
  });
  // Reapply restrictions to orders tabs already open when this worker starts.
  void chrome.tabs
    .query({ url: `${ordersPageUrl}*` })
    .then((tabs): void => {
      for (const tab of tabs)
        if (tab.id !== undefined) void refreshTabVisibility(tab.id);
    })
    .catch((): void => {});
}
