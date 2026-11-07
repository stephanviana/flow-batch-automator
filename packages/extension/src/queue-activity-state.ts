import {
  ACTIVE_TASK_STATES,
  type QueueSnapshot,
  type TaskSummary,
} from '@flow-batch/protocol';

export interface Activity {
  title: string;
  detail: string;
  tone: 'idle' | 'working' | 'success' | 'warning' | 'error';
  busy: boolean;
  task: TaskSummary | null;
  step: number;
}
export const activitySteps = {
  'google-flow': ['Referência', 'Imagem', 'Vídeo', 'MP4'],
  simulation: ['Recebimento', 'Simulação', 'Finalização'],
} as const;

function taskStep(task: TaskSummary): number {
  if (task.state === 'completed') return activitySteps[task.executor].length;
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
    detail: `Etapa ${step + 1} de ${activitySteps[task.executor].length}. ${
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
  const active = queue.tasks.find((task) =>
    ACTIVE_TASK_STATES.includes(task.state),
  );
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
