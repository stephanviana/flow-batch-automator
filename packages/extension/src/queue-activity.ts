import { ACTIVE_TASK_STATES, type QueueSnapshot } from '@flow-batch/protocol';
import { queueActivity } from './queue-activity-state.js';
import { renderActivityCard } from './queue-activity-card.js';

type Control = 'queue-start' | 'queue-pause';
let latestQueue: QueueSnapshot | null = null;
let latestError: string | null = null;
let pending: Control | null = null;
let notice: { text: string; error: boolean; expiresAt: number } | null = null;

function text(element: Element | null, value: string): void {
  if (element && element.textContent !== value) element.textContent = value;
}
function renderControls(): void {
  const start = document.querySelector<HTMLButtonElement>(
    '[data-action="queue-start"]',
  );
  const pause = document.querySelector<HTMLButtonElement>(
    '[data-action="queue-pause"]',
  );
  if (!start || !pause) return;
  const active = latestQueue?.tasks.some((task) =>
    ACTIVE_TASK_STATES.includes(task.state),
  );
  text(
    start,
    pending === 'queue-start'
      ? 'Iniciando fila…'
      : latestQueue?.running
        ? active
          ? 'Processando…'
          : 'Fila habilitada'
        : 'Processar fila',
  );
  text(pause, pending === 'queue-pause' ? 'Pausando fila…' : 'Pausar fila');
  start.disabled = Boolean(
    pending ||
    !latestQueue ||
    latestQueue.blockedByReview ||
    latestQueue.running,
  );
  pause.disabled = Boolean(pending || !latestQueue?.running);
  start.dataset.busy = String(
    pending === 'queue-start' || Boolean(active && latestQueue?.running),
  );
  pause.dataset.busy = String(pending === 'queue-pause');
  start.setAttribute('aria-busy', start.dataset.busy);
  pause.setAttribute('aria-busy', pause.dataset.busy);
}
function render(): void {
  const root = document.querySelector<HTMLElement>('#queue-activity');
  if (!root) return;
  const activity = queueActivity(latestQueue);
  if (!latestQueue && latestError) {
    activity.title = 'Não foi possível atualizar a fila';
    activity.detail = latestError;
    activity.tone = 'warning';
  }
  if (pending) {
    activity.title =
      pending === 'queue-start' ? 'Iniciando fila…' : 'Pausando fila…';
    activity.detail = 'Confirmando o comando com o orquestrador.';
    activity.busy = true;
    activity.tone = 'working';
  }
  renderActivityCard(activity, latestQueue?.running === false);
  renderControls();
  const feedback = document.querySelector<HTMLElement>('#queue-feedback');
  const current = notice && notice.expiresAt > Date.now() ? notice : null;
  text(
    feedback,
    pending ? activity.title : (current?.text ?? latestError ?? ''),
  );
  if (feedback)
    feedback.dataset.tone = pending
      ? 'working'
      : current?.error || (!current && latestError)
        ? 'error'
        : 'success';
}
export function renderQueueActivity(
  queue: QueueSnapshot | null,
  error: string | null,
): void {
  latestQueue = queue;
  latestError = error;
  render();
}
export function beginQueueControl(action: Control): void {
  pending = action;
  notice = null;
  latestError = null;
  render();
}
export function finishQueueControl(action: Control, error?: string): void {
  pending = null;
  const message =
    error ??
    (!latestQueue
      ? 'Não foi possível confirmar o comando. Confira a conexão.'
      : action === 'queue-start'
        ? latestQueue.counts.queued ||
          latestQueue.tasks.some((task) =>
            ACTIVE_TASK_STATES.includes(task.state),
          )
          ? 'Fila habilitada. Acompanhe as etapas no cartão de andamento.'
          : 'Fila habilitada. Nenhum take pendente.'
        : 'Fila pausada. Um take já iniciado continua até terminar.');
  notice = {
    text: message,
    error: Boolean(error || !latestQueue),
    expiresAt: Date.now() + 8000,
  };
  render();
}
