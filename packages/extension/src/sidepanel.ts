import { popupReplySchema } from '@flow-batch/protocol';
import type { PopupRequest } from '@flow-batch/protocol';
import { renderQueue, initializeQueueView } from './queue-ui.js';
import { initializePanelTabs } from './panel-tabs.js';
import { renderConnectionBadge, renderDashboard } from './dashboard-ui.js';
import {
  beginQueueControl,
  finishQueueControl,
  renderQueueActivity,
} from './queue-activity.js';

const status = document.querySelector<HTMLParagraphElement>('#status');
const code = document.querySelector<HTMLParagraphElement>('#code');
const flowStatus = document.querySelector<HTMLParagraphElement>('#flow-status');
const flowProject =
  document.querySelector<HTMLParagraphElement>('#flow-project');
const ordersLink = document.querySelector<HTMLAnchorElement>('#open-orders');
if (!status || !code || !flowStatus || !flowProject || !ordersLink)
  throw new Error('Side panel elements missing');
initializePanelTabs();

function showError(message: string): void {
  document.querySelector('#panel-feedback')!.textContent = message;
}
let pendingRequests = 0;
let requestSequence = 0;
let appliedSequence = 0;

ordersLink.addEventListener('click', async (event): Promise<void> => {
  event.preventDefault();
  try {
    await refresh({ type: 'orders-open' });
  } catch {
    showError('Não foi possível abrir o painel. Tente novamente.');
  }
});

async function refresh(
  request: PopupRequest = { type: 'status' },
): Promise<ReturnType<typeof popupReplySchema.parse>> {
  const control =
    request.type === 'queue-start' || request.type === 'queue-pause'
      ? request.type
      : null;
  const sequence = ++requestSequence;
  pendingRequests++;
  let controlError: string | undefined;
  if (control) beginQueueControl(control);
  try {
    const response: unknown = await chrome.runtime.sendMessage(request);
    const data = popupReplySchema.parse(response);
    const dispatch = await chrome.storage.local.get('dispatchStatus');
    if (typeof dispatch.dispatchStatus === 'string')
      document.querySelector<HTMLParagraphElement>(
        '#dispatch-status',
      )!.textContent = dispatch.dispatchStatus;
    if (control) controlError = data.operationError ?? undefined;
    if (sequence < appliedSequence) return data;
    appliedSequence = sequence;
    document.querySelector('#panel-feedback')!.textContent = '';
    status!.textContent = data.state.message;
    renderConnectionBadge(data.state.phase === 'connected');
    code!.textContent = data.state.code ? `Código: ${data.state.code}` : '';
    if (data.flow) {
      flowStatus!.textContent = data.flow.message;
      flowStatus!.dataset.phase = data.flow.phase;
      flowProject!.hidden = !data.flow.projectId;
      flowProject!.textContent = data.flow.projectId
        ? `Projeto: ${data.flow.projectId}`
        : '';
    }
    renderQueue(data.queue, data.inspection, data.operationError, refresh);
    return data;
  } catch (error) {
    controlError =
      'Não foi possível confirmar o comando. Confira a conexão e tente novamente.';
    if (sequence >= appliedSequence) {
      appliedSequence = sequence;
      const message =
        'Não foi possível atualizar a fila. Confira a conexão com a extensão.';
      renderQueueActivity(null, message);
      renderDashboard(null, message);
      renderConnectionBadge(false);
    }
    throw error;
  } finally {
    pendingRequests--;
    if (control) finishQueueControl(control, controlError);
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-action]',
)) {
  button.addEventListener('click', async (): Promise<void> => {
    button.disabled = true;
    try {
      await refresh({ type: button.dataset.action as PopupRequest['type'] });
    } catch {
      showError('Recarregue a extensão e tente novamente.');
    } finally {
      const action = button.dataset.action ?? '';
      if (!action.startsWith('queue-')) button.disabled = false;
    }
  });
}
initializeQueueView();
void refresh().catch((): void => {
  showError('Não foi possível consultar a extensão.');
});
setInterval((): void => {
  if (pendingRequests) return;
  void refresh().catch((): void => {
    showError('Aguardando resposta da extensão…');
  });
}, 2000);
