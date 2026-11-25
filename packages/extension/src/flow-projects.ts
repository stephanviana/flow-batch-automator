import { callFlowRpc } from './flow-rpc.js';
import type { FlowRpcReply } from './flow-rpc-page.js';
import { FlowInputError } from './flow-errors.js';

export function isFlowProject(
  url: string | undefined,
  projectId: string,
): boolean {
  if (!url) return false;
  const parsed = new URL(url);
  return (
    parsed.origin === 'https://flow.google.com' &&
    parsed.pathname.match(/\/project\/([^/]+)(?:\/|$)/)?.[1] === projectId
  );
}

async function flowTab(projectId?: string): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({
    url: 'https://flow.google.com/*',
    discarded: false,
  });
  const matching = projectId
    ? tabs.find((tab) => isFlowProject(tab.url, projectId))
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

interface ProjectReload {
  staleDocumentId: string;
  signal: AbortSignal;
}

async function readyTab(
  tabId: number,
  projectId?: string,
  reload?: ProjectReload,
): Promise<number> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    reload?.signal.throwIfAborted();
    const tab = await chrome.tabs.get(tabId);
    if (
      tab.status === 'complete' &&
      !tab.pendingUrl &&
      (projectId
        ? isFlowProject(tab.url, projectId)
        : tab.url?.startsWith('https://flow.google.com/'))
    ) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          args: [projectId ?? null],
          func: (expected: string | null) =>
            location.origin === 'https://flow.google.com' &&
            (!expected ||
              location.pathname.match(/\/project\/([^/]+)(?:\/|$)/)?.[1] ===
                expected) &&
            Boolean(
              (
                globalThis as typeof globalThis & {
                  WIZ_global_data?: { SNlM0e?: string };
                }
              ).WIZ_global_data?.SNlM0e,
            ),
        });
        if (
          result?.result &&
          (!reload ||
            (result.documentId && result.documentId !== reload.staleDocumentId))
        )
          return tabId;
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

export async function reloadFlowProject(
  tabId: number,
  projectId: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  if (!isFlowProject((await chrome.tabs.get(tabId)).url, projectId))
    throw new FlowInputError('A aba não está mais no projeto vinculado.');
  const [previous] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => true,
  });
  if (!previous?.documentId)
    throw new FlowInputError(
      'Não foi possível identificar o documento atual do Flow.',
    );
  signal.throwIfAborted();
  if (!isFlowProject((await chrome.tabs.get(tabId)).url, projectId))
    throw new FlowInputError('A aba não está mais no projeto vinculado.');
  await chrome.tabs.reload(tabId);
  await readyTab(tabId, projectId, {
    staleDocumentId: previous.documentId,
    signal,
  });
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
  return readyTab(tab.id, projectId);
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
    // FlowKit create_project_request (MIT); surface 22, no captcha.
    return await callFlowRpc(tab.id, {
      rpcId: 'jHPbke',
      projectId: '',
      payload: [
        'projects/*',
        [null, [name.replace(/\s+/g, ' ').trim().slice(0, 160)]],
        [null, 22],
      ],
    });
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
