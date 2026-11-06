import type {
  PopupRequest,
  QueueSnapshot,
  TaskDetail,
  TaskSummary,
} from '@flow-batch/protocol';
import { taskRow, taskStateLabels } from './queue-task-row.js';
import { renderDashboard } from './dashboard-ui.js';
import { renderQueueActivity } from './queue-activity.js';
type Send = (message: PopupRequest) => Promise<unknown>;
let historyStamp = '';
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
  renderQueueActivity(queue, error);
  renderDashboard(queue, error);
  const empty = document.querySelector<HTMLElement>('#queue-empty');
  if (empty) empty.hidden = !queue || queue.tasks.length > 0;
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
      summary.textContent += ` Exibindo ${queue.tasks.length} takes nesta lista.`;
  }
  renderTaskList(tasks, queue?.tasks ?? [], send);
  renderHistory(inspection, history);
}

function renderHistory(inspection: TaskDetail | null, history: Element): void {
  const details = document.querySelector<HTMLDetailsElement>('#task-history');
  if (details) details.hidden = !inspection;
  const nextHistoryStamp = JSON.stringify(
    inspection ? { id: inspection.task.id, events: inspection.events } : null,
  );
  if (historyStamp === nextHistoryStamp) return;
  historyStamp = nextHistoryStamp;
  history.replaceChildren();
  if (inspection) {
    if (details) details.open = true;
    for (const event of inspection.events) {
      const line = document.createElement('li');
      line.textContent = `${new Date(event.at).toLocaleTimeString()} · ${taskStateLabels[event.state]}${event.error ? ` · ${event.error.message}` : ''}`;
      history.append(line);
    }
    for (const { checkpoint } of inspection.checkpoints) {
      const line = document.createElement('li');
      line.textContent = `${checkpoint.stage}: ${'mediaId' in checkpoint ? checkpoint.mediaId : 'operationId' in checkpoint ? checkpoint.operationId : `download #${checkpoint.downloadId}`}`;
      history.append(line);
    }
  }
}
