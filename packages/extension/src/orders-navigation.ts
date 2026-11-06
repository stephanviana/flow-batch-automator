import { closeSidePanel, ordersPageUrl } from './orders-panel-visibility.js';

export async function openOrdersPanel(dispatchId?: string): Promise<void> {
  const destination = new URL(ordersPageUrl);
  if (dispatchId) destination.searchParams.set('dispatch', dispatchId);
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  const ordersTab = await chrome.tabs.create({
    url: destination.href,
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
