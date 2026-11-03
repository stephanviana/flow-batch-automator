async function closeSidePanel(windowId: number): Promise<void> {
  if (typeof chrome.sidePanel.close === 'function') {
    await chrome.sidePanel.close({ windowId });
    return;
  }
  // Chrome 120–140 has no close API. The worker must restore availability
  // after disabling the global panel destroys the side panel document.
  await chrome.sidePanel.setOptions({ enabled: false });
  await chrome.sidePanel.setOptions({ enabled: true });
}

export async function openOrdersPanel(): Promise<void> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  const ordersTab = await chrome.tabs.create({
    url: 'http://127.0.0.1:4319/orders',
    active: false,
    ...(activeTab
      ? { windowId: activeTab.windowId, index: activeTab.index + 1 }
      : {}),
  });
  if (ordersTab.id === undefined) throw new Error('Orders tab missing');
  await chrome.sidePanel.setOptions({ tabId: ordersTab.id, enabled: false });
  await chrome.tabs.update(ordersTab.id, { active: true });
  await closeSidePanel(ordersTab.windowId);
}
