import { closeSidePanel, ordersPageUrl } from './orders-panel-visibility.js';

export async function openOrdersPanel(): Promise<void> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  const ordersTab = await chrome.tabs.create({
    url: ordersPageUrl,
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
