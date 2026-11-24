import {
  flowInspectionSchema,
  type FlowInspection,
} from '@flow-batch/protocol';
import { callFlowRpc } from './flow-rpc.js';
import { flowPatterns, locateFlow } from './flow-location.js';

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
  try {
    const { tab, inspection } = await locateFlow();
    const projectId = inspection.projectId;
    if (tab?.id === undefined || !projectId) return inspection;
    const reply = await callFlowRpc(tab.id, {
      rpcId: 'Zzl0ze',
      projectId,
      payload: [`projects/${projectId}`, null, null, null, [1]],
    });
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
