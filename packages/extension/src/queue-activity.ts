import type { QueueSnapshot, TaskSummary } from '@flow-batch/protocol';

type Control = 'queue-start' | 'queue-pause';
interface Activity {
  title: string;
  detail: string;
  tone: 'idle' | 'working' | 'success' | 'warning' | 'error';
  busy: boolean;
  task: TaskSummary | null;
  step: number;
}
const activeStates = [
  'dispatching',
  'submitted',
  'generating',
  'download_pending',
];
const realSteps = ['Referência', 'Imagem', 'Vídeo', 'MP4'];
const simulatedSteps = ['Recebimento', 'Simulação', 'Finalização'];
let latestQueue: QueueSnapshot | null = null;
let latestError: string | null = null;
let pending: Control | null = null;
let notice: { text: string; error: boolean; expiresAt: number } | null = null;

function taskStep(task: TaskSummary): number {
  if (task.state === 'completed') return task.executor === 'simulation' ? 3 : 4;
  if (task.executor === 'simulation')
    return task.state === 'download_pending'
      ? 2
      : task.state === 'generating'
        ? 1
        : 0;
  if (
    task.state === 'download_pending' ||
    task.step === 'video_ready' ||
    task.step === 'download_started'
  )
    return 3;
  if (
    task.step === 'image_generated' ||
    task.step === 'image_reused' ||
    task.step === 'video_submitted'
  )
    return 2;
  if (
    task.state === 'generating' ||
    task.state === 'submitted' ||
    task.step === 'reference_uploaded'
  )
    return 1;
  return 0;
}
function processing(task: TaskSummary, running: boolean): Activity {
  const step = taskStep(task);
  const title =
    task.executor === 'simulation'
      ? [
          'Recebendo simulação',
          'Processando simulação',
          'Finalizando simulação',
        ][step]!
      : [
          'Preparando e enviando referência',
          'Gerando imagem no Flow',
          'Gerando vídeo no Flow',
          'Baixando MP4',
        ][step]!;
  return {
    title,
    detail: `Etapa ${step + 1} de ${task.executor === 'simulation' ? 3 : 4}. ${
      running
        ? 'Em andamento; as etapas são atualizadas automaticamente.'
        : 'O take atual continua. A fila está pausada para os próximos.'
    }`,
    tone: 'working',
    busy: true,
    task,
    step,
  };
}
export function queueActivity(queue: QueueSnapshot | null): Activity {
  const idle: Activity = {
    title: 'Fila indisponível',
    detail: 'Conecte a extensão para acompanhar o processamento.',
    tone: 'idle',
    busy: false,
    task: null,
    step: 0,
  };
  if (!queue) return idle;
  const uncertain =
    queue.tasks.find((task) => task.state === 'uncertain') ?? null;
  if (queue.blockedByReview)
    return {
      ...idle,
      title: 'Resultado incerto · revisão necessária',
      detail:
        'Confira o Flow e os downloads. A fila aguarda sua revisão antes de continuar.',
      tone: 'warning',
      task: uncertain,
      step: uncertain ? taskStep(uncertain) : 0,
    };
  const active = queue.tasks.find((task) => activeStates.includes(task.state));
  if (active) return processing(active, queue.running);
  if (queue.counts.queued > 0)
    return {
      ...idle,
      title: queue.running
        ? 'Aguardando início do próximo take'
        : 'Fila pausada',
      detail: `${queue.counts.queued} take(s) aguardando${queue.running ? ' execução.' : '. Use Processar fila para iniciar.'}`,
      busy: queue.running,
      tone: queue.running ? 'working' : 'idle',
    };
  const latest = [...queue.tasks].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  )[0];
  if (latest?.state === 'completed')
    return {
      ...idle,
      title:
        latest.executor === 'simulation'
          ? 'Simulação concluída'
          : 'Take concluído · MP4 disponível',
      detail:
        latest.executor === 'simulation'
          ? 'O teste terminou. Nenhuma mídia foi gerada.'
          : 'O Chrome confirmou o download. Se a mídia não aparecer no Flow, recarregue a página após a conclusão.',
      tone: 'success',
      task: latest,
      step: taskStep(latest),
    };
  if (latest?.state === 'failed')
    return {
      ...idle,
      title: 'Take não concluído',
      detail:
        latest.lastError?.message ??
        'Consulte o histórico para conferir o resultado da tentativa.',
      tone: 'error',
      task: latest,
      step: taskStep(latest),
    };
  return {
    ...idle,
    title: queue.running ? 'Fila habilitada · sem pendências' : 'Fila vazia',
    detail: 'Enfileire um take para começar.',
  };
}
function text(element: Element | null, value: string): void {
  if (element && element.textContent !== value) element.textContent = value;
}
function renderSteps(activity: Activity): void {
  const list = document.querySelector<HTMLOListElement>('#queue-steps');
  if (!list) return;
  list.hidden = !activity.task;
  if (!activity.task) return;
  const labels =
    activity.task?.executor === 'simulation' ? simulatedSteps : realSteps;
  if (list.dataset.kind !== activity.task?.executor) {
    list.replaceChildren(
      ...labels.map((label, index) => {
        const entry = document.createElement('li');
        const marker = document.createElement('span');
        marker.className = 'step-marker';
        marker.setAttribute('aria-hidden', 'true');
        marker.textContent = String(index + 1);
        const caption = document.createElement('span');
        caption.textContent = label;
        entry.append(marker, caption);
        return entry;
      }),
    );
    list.dataset.kind = activity.task?.executor ?? '';
  }
  Array.from(list.children).forEach((entry, index) => {
    const done = index < activity.step;
    entry.setAttribute(
      'data-status',
      done ? 'done' : index === activity.step ? 'current' : 'waiting',
    );
    if (index === activity.step) entry.setAttribute('aria-current', 'step');
    else entry.removeAttribute('aria-current');
    text(entry.querySelector('.step-marker'), done ? '✓' : String(index + 1));
  });
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
    activeStates.includes(task.state),
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
  root.dataset.tone = activity.tone;
  root.dataset.busy = String(activity.busy);
  text(document.querySelector('#queue-activity-title'), activity.title);
  text(document.querySelector('#queue-activity-detail'), activity.detail);
  const task = document.querySelector<HTMLElement>('#queue-activity-task');
  if (task) {
    const label = activity.task
      ? `${activity.task.product} / ${activity.task.video} / ${activity.task.take}`
      : '';
    task.hidden = !label;
    text(task, label);
    task.title = label;
  }
  const clock = document.querySelector<HTMLElement>('#queue-activity-time');
  if (clock) {
    clock.hidden = !activity.task;
    const seconds = activity.task
      ? Math.max(0, Math.floor((Date.now() - activity.task.updatedAt) / 1000))
      : 0;
    const elapsed =
      seconds < 60
        ? `${seconds} s`
        : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
    text(
      clock,
      activity.task
        ? activity.busy
          ? `Nesta etapa há ${elapsed}`
          : `Atualizado às ${new Date(activity.task.updatedAt).toLocaleTimeString('pt-BR')}`
        : '',
    );
  }
  renderSteps(activity);
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
          latestQueue.tasks.some((task) => activeStates.includes(task.state))
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
