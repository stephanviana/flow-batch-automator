import {
  taskInputSchema,
  type PopupRequest,
  type TaskInput,
  taskDetailSchema,
} from '@flow-batch/protocol';
import { signedRequest } from './api.js';
import { enqueueFlow } from './flow-enqueue.js';

function demoTasks(type: PopupRequest['type']): TaskInput[] {
  const scenario =
    type === 'enqueue-retry-demo'
      ? 'transient_before_submit'
      : type === 'enqueue-stall-demo'
        ? 'stall_after_submit'
        : 'success';
  const takes = scenario === 'success' ? ['Hook', 'Body', 'CTA'] : ['Hook'];
  return takes.map((take) =>
    taskInputSchema.parse({
      taskKey: crypto.randomUUID(),
      product: 'Produto de demonstração',
      video: 'Teste da fila',
      format: '9:16',
      take,
      references: [],
      original: {
        imagePrompt: '{"prompt":"SIMULAÇÃO — não gerar mídia"}',
        videoPrompt: `SIMULAÇÃO ${take}`,
        copy: `Copy de teste: ${take}`,
      },
      executor: 'simulation',
      simulation: { durationMs: 3000, scenario, failAttempts: 1 },
      maxAttempts: 3,
    }),
  );
}

export async function queueCommand(
  clientId: string,
  message: PopupRequest,
): Promise<void> {
  if (message.type === 'enqueue-flow') {
    if (!message.flowDraft)
      throw new Error('Preencha o take e confirme o consumo de créditos.');
    await enqueueFlow(clientId, message.flowDraft);
    return;
  }
  if (message.type.startsWith('enqueue-')) {
    await signedRequest(clientId, 'POST', '/api/queue', {
      requestId: crypto.randomUUID(),
      tasks: demoTasks(message.type),
    });
    return;
  }
  if (message.type === 'queue-start' || message.type === 'queue-pause') {
    await signedRequest(clientId, 'POST', '/api/queue/control', {
      action: message.type === 'queue-start' ? 'start' : 'pause',
    });
    return;
  }
  if (message.type === 'queue-show-download') {
    const detail = taskDetailSchema.parse(
      await signedRequest(clientId, 'POST', '/api/queue/task', {
        taskId: message.taskId,
      }),
    );
    if (
      detail.task.state !== 'completed' ||
      !detail.task.result ||
      detail.task.result.simulated
    )
      throw new Error('Download indisponível.');
    chrome.downloads.show(detail.task.result.downloadId);
    return;
  }
  if (!message.taskId || message.expectedRevision === undefined)
    throw new Error('Refresh the task before acting');
  const common = {
    requestId: crypto.randomUUID(),
    taskId: message.taskId,
    expectedRevision: message.expectedRevision,
  };
  const action =
    message.type === 'queue-retry'
      ? { ...common, action: 'retry', acknowledgeDuplicateRisk: false }
      : message.type === 'queue-cancel'
        ? { ...common, action: 'cancel' }
        : {
            ...common,
            action: 'resolve',
            outcome: message.reviewOutcome ?? 'not_submitted',
            note:
              message.note ??
              'Operador revisou o teste simulado; não houve envio externo ao Flow.',
          };
  await signedRequest(clientId, 'POST', '/api/queue/actions', action);
}
