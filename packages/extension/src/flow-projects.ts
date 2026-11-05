import { flowRpcPage } from './flow-rpc-page.js';
import type { FlowRpcReply } from './flow-rpc-page.js';
import { FlowInputError } from './flow-errors.js';

async function flowTab(projectId?: string): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({
    url: 'https://flow.google.com/*',
    discarded: false,
  });
  const matching = projectId
    ? tabs.find(
        (tab) =>
          tab.url &&
          new URL(tab.url).pathname.match(/\/project\/([^/]+)(?:\/|$)/)?.[1] ===
            projectId,
      )
    : undefined;
  const tab = matching ?? tabs.find((candidate) => candidate.active) ?? tabs[0];
  if (tab?.id === undefined)
    throw new FlowInputError(
      'Abra o Google Flow e entre na sua conta antes de preparar ou abrir um lote.',
    );
  return tab;
}

async function navigate(tabId: number, url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(updated);
    };
    const updated = (id: number, change: chrome.tabs.OnUpdatedInfo): void => {
      if (id !== tabId || change.status !== 'complete') return;
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new FlowInputError(
          'O Flow não terminou de carregar. Confira a aba e abra o lote novamente.',
        ),
      );
    }, 20000);
    chrome.tabs.onUpdated.addListener(updated);
    void chrome.tabs.update(tabId, { url }).catch(() => {
      cleanup();
      reject(new FlowInputError('Não foi possível acessar a aba do Flow.'));
    });
  });
}

async function readyTab(tabId: number): Promise<number> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (
      tab.status === 'complete' &&
      tab.url?.startsWith('https://flow.google.com/')
    ) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: () =>
            Boolean(
              (
                globalThis as typeof globalThis & {
                  WIZ_global_data?: { SNlM0e?: string };
                }
              ).WIZ_global_data?.SNlM0e,
            ),
        });
        if (result?.result) return tabId;
      } catch {
        // Navigation may still be switching documents. Readiness is read-only.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new FlowInputError(
    'Entre no Flow e aguarde a página carregar. Depois abra o lote novamente.',
  );
}

export async function openProject(
  projectId: string,
  active = true,
): Promise<number> {
  const tab = await flowTab(projectId);
  if (tab.id === undefined)
    throw new FlowInputError('Não foi possível abrir o projeto do lote.');
  const url = `https://flow.google.com/project/${encodeURIComponent(projectId)}`;
  if (tab.url && new URL(tab.url).pathname !== new URL(url).pathname)
    await navigate(tab.id, url);
  if (active) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return readyTab(tab.id);
}

export async function createProject(name: string): Promise<FlowRpcReply> {
  // Only nonpaid project creation is permitted here. Never generate media.
  let injected = false;
  let step = 'locate_tab';
  try {
    const tab = await flowTab();
    if (tab.id === undefined) throw new Error('No Flow tab');
    step = 'navigate';
    await navigate(tab.id, 'https://flow.google.com/');
    step = 'wait_ready';
    await readyTab(tab.id);
    injected = true;
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: flowRpcPage,
      // FlowKit create_project_request (MIT); surface 22, no captcha.
      args: [
        {
          rpcId: 'jHPbke',
          projectId: '',
          payload: [
            'projects/*',
            [null, [name.replace(/\s+/g, ' ').trim().slice(0, 160)]],
            [null, 22],
          ],
        },
      ],
    });
    if (result?.result) return result.result;
  } catch {
    /* Injection failure after dispatch has an unknown outcome. */
  }
  return {
    ok: false,
    code: injected ? 'flow_project_creation_unknown' : `project_${step}_failed`,
    message:
      'Não foi possível confirmar a criação. Confira os projetos no Flow.',
    sent: injected,
  };
}
