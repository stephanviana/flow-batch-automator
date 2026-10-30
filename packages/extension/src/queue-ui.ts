import type {
  PopupRequest,
  QueueSnapshot,
  TaskDetail,
  TaskState,
  TaskSummary,
} from '@flow-batch/protocol';
type Send = (message: PopupRequest) => Promise<unknown>;
let historyStamp = '';
const labels: Record<TaskState, string> = {
  queued: 'Pendente',
  dispatching: 'Enviando',
  submitted: 'Envio confirmado',
  generating: 'Gerando',
  download_pending: 'Baixando MP4',
  completed: 'Concluída',
  failed: 'Falha',
  uncertain: 'Incerta · requer revisão',
  cancelled: 'Cancelada',
};

function button(
  parent: HTMLElement,
  label: string,
  message: PopupRequest,
  send: Send,
): void {
  const control = document.createElement('button');
  control.type = 'button';
  control.textContent = label;
  control.addEventListener('click', async (): Promise<void> => {
    control.disabled = true;
    try {
      await send(message);
    } catch {
      const feedback = document.querySelector('#queue-feedback');
      if (feedback)
        feedback.textContent =
          'Não foi possível operar a tarefa. Atualize a extensão e tente novamente.';
    } finally {
      control.disabled = false;
    }
  });
  parent.append(control);
}
function taskRow(task: TaskSummary, send: Send): HTMLLIElement {
  const row = document.createElement('li');
  row.dataset.taskId = task.id;
  row.dataset.executor = task.executor;
  row.dataset.state = task.state;
  row.dataset.attemptCount = String(task.attemptCount);
  row.dataset.revision = String(task.revision);
  const description = document.createElement('p');
  description.textContent = `${task.product} / ${task.video} / ${task.take} (${task.format}) · ${labels[task.state]} · tentativas ${task.attemptCount}/${task.maxAttempts}`;
  row.append(description);
  if (task.lastError) {
    const error = document.createElement('p');
    error.textContent = task.lastError.message;
    row.append(error);
  }
  const common = { taskId: task.id, expectedRevision: task.revision };
  button(row, 'Ver histórico', { type: 'queue-inspect', ...common }, send);
  if (task.state === 'queued')
    button(row, 'Cancelar', { type: 'queue-cancel', ...common }, send);
  if (task.state === 'uncertain')
    button(
      row,
      'Revisar: confirmar sem envio externo',
      { type: 'queue-resolve', ...common },
      send,
    );
  if (
    task.state === 'failed' &&
    task.safeToRetry &&
    task.attemptCount < task.maxAttempts
  )
    button(row, 'Tentar novamente', { type: 'queue-retry', ...common }, send);
  return row;
}

function renderTaskList(
  container: Element,
  records: TaskSummary[],
  send: Send,
): void {
  const rows = new Map(
    Array.from(container.children)
      .filter((child): child is HTMLLIElement => child instanceof HTMLLIElement)
      .map((row) => [row.dataset.taskId, row]),
  );
  const ids = new Set(records.map((task) => task.id));
  for (const [id, row] of rows) if (!id || !ids.has(id)) row.remove();
  records.forEach((task, index) => {
    let row = rows.get(task.id);
    if (!row || row.dataset.revision !== String(task.revision)) {
      const replacement = taskRow(task, send);
      if (row?.isConnected) row.replaceWith(replacement);
      row = replacement;
    }
    const position = container.children.item(index);
    if (position !== row) container.insertBefore(row, position);
  });
}

export function renderQueue(
  queue: QueueSnapshot | null,
  inspection: TaskDetail | null,
  error: string | null,
  send: Send,
): void {
  const summary = document.querySelector('#queue-status');
  const feedback = document.querySelector('#queue-feedback');
  const tasks = document.querySelector('#queue-tasks');
  const history = document.querySelector('#queue-history');
  if (!summary || !feedback || !tasks || !history) return;
  feedback.textContent = error ?? '';
  for (const control of document.querySelectorAll<HTMLButtonElement>(
    '[data-action^="queue-"]',
  ))
    control.disabled =
      !queue ||
      (control.dataset.action === 'queue-start' && queue.blockedByReview);
  summary.textContent = !queue
    ? 'Fila indisponível. Conecte a extensão.'
    : queue.blockedByReview
      ? 'Fila bloqueada: revise o resultado incerto.'
      : queue.running
        ? 'Processamento habilitado.'
        : 'Fila pausada.';
  if (queue) {
    const total = Object.values(queue.counts).reduce(
      (sum, count) => sum + count,
      0,
    );
    summary.textContent += ` ${total} tarefas: ${queue.counts.queued} pendentes, ${queue.counts.completed} concluídas.`;
    if (total > queue.tasks.length)
      summary.textContent += ` Exibindo ${queue.tasks.length}.`;
  }
  renderTaskList(tasks, queue?.tasks ?? [], send);
  for (const control of document.querySelectorAll<HTMLButtonElement>(
    '[data-action^="enqueue-"]',
  )) {
    control.disabled =
      !queue ||
      (control.dataset.action === 'queue-start' && queue.blockedByReview);
  }
  const nextHistoryStamp = JSON.stringify(
    inspection ? { id: inspection.task.id, events: inspection.events } : null,
  );
  if (historyStamp === nextHistoryStamp) return;
  historyStamp = nextHistoryStamp;
  history.replaceChildren();
  if (inspection) {
    for (const event of inspection.events) {
      const line = document.createElement('li');
      line.textContent = `${new Date(event.at).toLocaleTimeString()} · ${labels[event.state]}${event.error ? ` · ${event.error.message}` : ''}`;
      history.append(line);
    }
  }
}
