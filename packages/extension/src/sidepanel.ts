import { popupReplySchema } from '@flow-batch/protocol';
import type { PopupRequest } from '@flow-batch/protocol';
import { renderQueue } from './queue-ui.js';
import {
  beginQueueControl,
  finishQueueControl,
  renderQueueActivity,
} from './queue-activity.js';
import { initializeFlowForm, renderFlowForm } from './flow-form.js';
import { initializeBatchForm, renderBatchForm } from './batch-form.js';

const status = document.querySelector<HTMLParagraphElement>('#status');
const code = document.querySelector<HTMLParagraphElement>('#code');
const history = document.querySelector<HTMLUListElement>('#history');
const flowStatus = document.querySelector<HTMLParagraphElement>('#flow-status');
const flowProject =
  document.querySelector<HTMLParagraphElement>('#flow-project');
const simulate = document.querySelector<HTMLButtonElement>(
  '[data-action="simulate"]',
);
if (!status || !code || !history || !simulate || !flowStatus || !flowProject)
  throw new Error('Side panel elements missing');
const labels = {
  sent: 'Enviada',
  running: 'Em execução',
  completed: 'Concluída',
  interrupted: 'Interrompida · sem reenvio',
};
let simulationStamp = '';
let pendingRequests = 0;
let requestSequence = 0;
let appliedSequence = 0;

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
    if (control) controlError = data.operationError ?? undefined;
    if (sequence < appliedSequence) return data;
    appliedSequence = sequence;
    status!.textContent = data.state.message;
    code!.textContent = data.state.code ? `Código: ${data.state.code}` : '';
    simulate!.disabled = data.state.phase !== 'connected';
    if (data.flow) {
      flowStatus!.textContent = data.flow.message;
      flowStatus!.dataset.phase = data.flow.phase;
      flowProject!.hidden = !data.flow.projectId;
      flowProject!.textContent = data.flow.projectId
        ? `Projeto: ${data.flow.projectId}`
        : '';
    }
    renderQueue(data.queue, data.inspection, data.operationError, refresh);
    renderFlowForm(data);
    renderBatchForm(data);
    const nextSimulationStamp = JSON.stringify(data.simulations);
    if (nextSimulationStamp === simulationStamp) return data;
    simulationStamp = nextSimulationStamp;
    history!.replaceChildren();
    for (const task of data.simulations) {
      const entry = document.createElement('li');
      entry.textContent = `${task.id.slice(0, 8)} · ${labels[task.state]}`;
      history!.append(entry);
    }
    return data;
  } catch (error) {
    controlError =
      'Não foi possível confirmar o comando. Confira a conexão e tente novamente.';
    if (sequence >= appliedSequence) {
      appliedSequence = sequence;
      renderQueueActivity(
        null,
        'Não foi possível atualizar a fila. Confira a conexão com a extensão.',
      );
    }
    throw error;
  } finally {
    pendingRequests--;
    if (control) finishQueueControl(control, controlError);
  }
}
initializeFlowForm(refresh);
initializeBatchForm(refresh);
for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-action]',
)) {
  button.addEventListener('click', async (): Promise<void> => {
    button.disabled = true;
    try {
      await refresh({ type: button.dataset.action as PopupRequest['type'] });
    } catch {
      status.textContent = 'Recarregue a extensão e tente novamente.';
    } finally {
      const action = button.dataset.action ?? '';
      if (
        button !== simulate &&
        !action.startsWith('queue-') &&
        !action.startsWith('enqueue-')
      )
        button.disabled = false;
    }
  });
}
void refresh().catch((): void => {
  status.textContent = 'Não foi possível consultar a extensão.';
});
setInterval((): void => {
  if (pendingRequests) return;
  void refresh().catch((): void => {
    status.textContent = 'Aguardando resposta do worker…';
  });
}, 2000);
