import type { FlowInspection } from '@flow-batch/protocol';

export const flowPatterns = [
  'https://flow.google.com/*',
  'https://labs.google/fx/*',
];

interface FlowLocation {
  tab: chrome.tabs.Tab | undefined;
  inspection: FlowInspection;
}

function locationState(
  tab: chrome.tabs.Tab | undefined,
  message: string,
  projectId: string | null = null,
): FlowLocation {
  return {
    tab,
    inspection: {
      phase: tab ? 'not-ready' : 'no-tab',
      message,
      projectId,
      checkedAt: Date.now(),
    },
  };
}

export async function locateFlow(): Promise<FlowLocation> {
  const tabs = await chrome.tabs.query({ url: flowPatterns, discarded: false });
  const projects = tabs.filter((tab) => tab.url?.includes('/project/'));
  const focusedWindow = await chrome.windows.getLastFocused();
  const selected =
    tabs.find((tab) => tab.active && tab.windowId === focusedWindow.id) ??
    (projects.length === 1 ? projects[0] : undefined) ??
    (tabs.length === 1 ? tabs[0] : undefined);
  if (!selected)
    return locationState(
      undefined,
      tabs.length
        ? 'Selecione uma aba do Google Flow para acompanhar o projeto aberto.'
        : 'Abra o Google Flow e entre na sua conta para iniciar um projeto.',
    );
  const url = new URL(selected.pendingUrl ?? selected.url ?? '');
  if (url.origin !== 'https://flow.google.com')
    return locationState(
      selected,
      'Abra o Google Flow em flow.google.com para iniciar um projeto.',
    );
  const projectId = url.pathname.match(
    /\/project\/([a-zA-Z0-9_-]{1,128})(?:\/|$)/,
  )?.[1];
  if (!projectId)
    return locationState(
      selected,
      'Nenhum projeto aberto. Monte um pedido no painel para iniciar uma nova produção.',
    );
  return locationState(
    selected,
    selected.status === 'loading'
      ? 'Carregando o projeto no Google Flow…'
      : 'Projeto aberto no Flow. Verifique o projeto ou acompanhe a produção na fila.',
    projectId,
  );
}

// Refresh only the tab location; reading the dashboard never sends Flow RPCs.
export async function currentFlow(
  verified: FlowInspection | null,
): Promise<FlowInspection> {
  try {
    const { tab, inspection } = await locateFlow();
    return inspection.projectId &&
      inspection.projectId === verified?.projectId &&
      tab?.status !== 'loading' &&
      !tab?.pendingUrl
      ? verified
      : inspection;
  } catch {
    return {
      phase: 'error',
      message:
        'Não foi possível consultar a aba do Flow. Abra o Google Flow para iniciar um projeto.',
      projectId: null,
      checkedAt: Date.now(),
    };
  }
}
