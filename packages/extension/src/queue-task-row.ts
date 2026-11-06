import type {
  PopupRequest,
  TaskState,
  TaskSummary,
} from '@flow-batch/protocol';
type Send = (message: PopupRequest) => Promise<unknown>;
export const taskStateLabels: Record<TaskState, string> = {
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

function appendTaskDescription(row: HTMLElement, task: TaskSummary): void {
  const content = document.createElement('div');
  content.className = 'task-content';
  const title = document.createElement('h3');
  title.className = 'task-title';
  title.textContent = task.product;
  const meta = document.createElement('p');
  meta.className = 'task-meta';
  meta.textContent = `${task.video} · ${task.take} · ${task.format}`;
  const execution = document.createElement('p');
  execution.className = 'task-meta';
  execution.textContent = `${task.batchName ? `${task.batchName} · ` : ''}${executionLabel(task)} · tentativas ${task.attemptCount}/${task.maxAttempts}`;
  content.append(title, meta, execution);
  const state = document.createElement('span');
  state.className = 'task-state';
  state.textContent = taskStateLabels[task.state];
  row.append(content, state);
  appendTaskDetails(row, task);
}

function appendTaskDetails(row: HTMLElement, task: TaskSummary): void {
  if (task.lastError) {
    const error = document.createElement('p');
    error.className = 'task-error';
    error.textContent = task.lastError.message;
    row.append(error);
  }
  if (task.result && !task.result.simulated) {
    const output = document.createElement('p');
    output.className = 'task-output';
    const filename = task.result.outputFile.split(/[/\\]/).at(-1);
    output.textContent = `MP4: ${filename}`;
    output.title = task.result.outputFile;
    row.append(output);
  }
}

function executionLabel(task: TaskSummary): string {
  const steps = {
    reference_uploaded: 'Referência enviada',
    image_generated: 'Imagem gerada',
    image_reused: 'Imagem de origem reutilizada',
    video_submitted: 'Vídeo solicitado',
    video_ready: 'Vídeo localizado',
    download_started: 'Download iniciado',
  };
  return task.executor === 'simulation'
    ? 'Simulação'
    : `Google Flow${task.step ? ` · ${steps[task.step]}` : ''}`;
}

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
export function taskRow(task: TaskSummary, send: Send): HTMLLIElement {
  const row = document.createElement('li');
  row.dataset.taskId = task.id;
  row.dataset.executor = task.executor;
  row.dataset.state = task.state;
  row.dataset.attemptCount = String(task.attemptCount);
  row.dataset.revision = String(task.revision);
  appendTaskDescription(row, task);
  appendTaskActions(row, task, send);
  return row;
}

function appendTaskActions(
  row: HTMLElement,
  task: TaskSummary,
  send: Send,
): void {
  const actions = document.createElement('div');
  actions.className = 'task-actions';
  row.append(actions);
  if (task.result && !task.result.simulated)
    button(
      actions,
      'Mostrar MP4 na pasta',
      { type: 'queue-show-download', taskId: task.id },
      send,
    );
  const common = { taskId: task.id, expectedRevision: task.revision };
  button(actions, 'Ver histórico', { type: 'queue-inspect', ...common }, send);
  if (task.state === 'queued')
    button(actions, 'Cancelar', { type: 'queue-cancel', ...common }, send);
  if (task.state === 'uncertain') appendTaskReview(row, actions, task, send);
  if (
    task.state === 'failed' &&
    task.safeToRetry &&
    task.attemptCount < task.maxAttempts
  )
    button(
      actions,
      'Tentar novamente',
      { type: 'queue-retry', ...common },
      send,
    );
}

function appendTaskReview(
  row: HTMLElement,
  actions: HTMLElement,
  task: TaskSummary,
  send: Send,
): void {
  const common = { taskId: task.id, expectedRevision: task.revision };
  if (task.state === 'uncertain' && task.executor === 'simulation')
    button(
      actions,
      'Revisar: confirmar sem envio externo',
      { type: 'queue-resolve', ...common },
      send,
    );
  if (task.state === 'uncertain' && task.executor === 'google-flow') {
    const note = document.createElement('textarea');
    note.placeholder =
      'Confira o projeto no Flow e registre o resultado observado.';

    note.maxLength = 500;
    note.setAttribute('aria-label', 'Nota de revisão');
    note.className = 'task-review';
    row.insertBefore(note, actions);
    button(
      actions,
      'Encerrar tentativa com falha',
      { type: 'queue-resolve', ...common, reviewOutcome: 'failed' },
      async (message) => {
        if (!note.value.trim()) {
          note.focus();
          return;
        }
        await send({ ...message, note: note.value });
      },
    );
  }
}
