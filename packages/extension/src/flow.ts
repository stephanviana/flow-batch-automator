import {
  flowInspectionSchema,
  type FlowInspection,
} from '@flow-batch/protocol';
import { flowRpcPage } from './flow-rpc-page.js';

const flowPatterns = ['https://flow.google.com/*', 'https://labs.google/fx/*'];

export async function openFlow(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: flowPatterns });
  const existing = tabs.find((tab) => tab.active && !tab.discarded) ?? tabs[0];
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else await chrome.tabs.create({ url: 'https://flow.google.com/' });
}

export async function inspectFlow(): Promise<FlowInspection> {
  const unavailable = (
    phase: FlowInspection['phase'],
    message: string,
  ): FlowInspection => ({
    phase,
    message,
    projectId: null,
    checkedAt: Date.now(),
  });
  const tabs = await chrome.tabs.query({ url: flowPatterns, discarded: false });
  const projects = tabs.filter((tab) => tab.url?.includes('/project/'));
  const focusedWindow = await chrome.windows.getLastFocused();
  const active = tabs.find(
    (tab) => tab.active && tab.windowId === focusedWindow.id,
  );
  const selected =
    active ??
    (projects.length === 1 ? projects[0] : undefined) ??
    (tabs.length === 1 ? tabs[0] : undefined);
  if (!selected?.id)
    return unavailable(
      'no-tab',
      tabs.length
        ? 'Selecione a aba do projeto que deseja usar e verifique novamente.'
        : 'Abra o Google Flow e entre na sua conta.',
    );
  try {
    const url = new URL(selected.url ?? '');
    const projectId = url.pathname.match(
      /\/project\/([a-zA-Z0-9_-]{1,128})(?:\/|$)/,
    )?.[1];
    if (url.origin !== 'https://flow.google.com')
      return unavailable('not-ready', 'Abra seu projeto em flow.google.com.');
    if (!projectId)
      return unavailable(
        'not-ready',
        'Abra um projeto no Flow e verifique novamente.',
      );
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: selected.id },
      world: 'MAIN',
      func: flowRpcPage,
      args: [
        {
          rpcId: 'Zzl0ze',
          projectId,
          payload: [`projects/${projectId}`, null, null, null, [1]],
        },
      ],
    });
    const reply = injection?.result;
    return flowInspectionSchema.parse({
      phase: reply?.ok
        ? 'ready'
        : reply?.code === 'flow_session_missing' ||
            reply?.code === 'flow_project_changed'
          ? 'not-ready'
          : 'error',
      message: reply?.ok
        ? 'Sessão verificada. A leitura do projeto pelo Flow funcionou.'
        : (reply?.message ?? 'Não foi possível acessar o Flow.'),
      projectId,
      checkedAt: Date.now(),
    });
  } catch {
    return unavailable(
      'error',
      'Não foi possível acessar a aba do Flow. Recarregue a extensão e o projeto.',
    );
  }
}
