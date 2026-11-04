import {
  flowIdSchema,
  flowResultSchema,
  type FlowExecute,
  type QueueProgress,
  type QueueCheckpoint,
} from '@flow-batch/protocol';
import { z } from 'zod';
import { loadReference } from './flow-assets.js';
import {
  flowRpcPage,
  type FlowRpcRequest,
  type FlowRpcValue,
} from './flow-rpc-page.js';
import { uploadRequest, imageRequest, videoRequest } from './flow-payloads.js';
import { downloadVideo, FlowDownloadError } from './flow-download.js';
import { openProject } from './flow-projects.js';

export class FlowRunError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly notSubmitted: boolean,
  ) {
    super(message);
  }
}
const replySchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    value: z.strictObject({
      mediaId: flowIdSchema.nullable().optional(),
      operationId: flowIdSchema.optional(),
      status: z.string().max(80).optional(),
      videoUrl: z.url().max(8192).nullable().optional(),
      ready: z.boolean().optional(),
    }),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.string().max(80),
    message: z.string().max(200),
    sent: z.boolean(),
  }),
]);
type CheckpointBody<T = QueueCheckpoint> = T extends QueueCheckpoint
  ? Omit<T, 'type' | 'taskId' | 'attemptId'>
  : never;
type Emit = (event: QueueProgress | QueueCheckpoint) => void;
interface FrameEvents {
  submitted: () => void;
  generating: () => void;
  checkpoint: (event: CheckpointBody) => void;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = (): void => {
      clearTimeout(timer);
      reject(new Error('Execution stopped'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted);
      resolve();
    }, milliseconds);
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
  });
}
async function projectTab(projectId: string, reopen: boolean): Promise<number> {
  const tabs = await chrome.tabs.query({
    url: 'https://flow.google.com/*',
    discarded: false,
  });
  const matching = tabs.filter(
    (tab) =>
      tab.url &&
      new URL(tab.url).pathname.match(
        /\/project\/([a-zA-Z0-9_-]+)(?:\/|$)/,
      )?.[1] === projectId,
  );
  const selected = matching.find((tab) => tab.active) ?? matching[0];
  if (selected?.id === undefined && reopen) {
    try {
      return await openProject(projectId, false);
    } catch {
      throw new FlowRunError(
        'flow_project_missing',
        'Não foi possível abrir o projeto do lote. Confira a sessão do Flow.',
        true,
      );
    }
  }
  if (selected?.id === undefined)
    throw new FlowRunError(
      'flow_project_missing',
      'Abra o projeto vinculado à tarefa antes de processar a fila.',
      true,
    );
  return selected.id;
}
class FlowRunner {
  private sent = false;
  constructor(
    private readonly tabId: number,
    private readonly signal: AbortSignal,
  ) {}

  async rpc(request: FlowRpcRequest): Promise<FlowRpcValue> {
    this.signal.throwIfAborted();
    let raw: unknown;
    try {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId: this.tabId },
        world: 'MAIN',
        func: flowRpcPage,
        args: [request],
      });
      raw = injected?.result;
    } catch {
      throw new FlowRunError(
        'flow_dispatch_unknown',
        'Não foi possível confirmar a chamada na aba do Flow. Revise o projeto.',
        false,
      );
    }
    const parsed = replySchema.safeParse(raw);
    if (!parsed.success)
      throw new FlowRunError(
        'flow_response_invalid',
        'O adaptador recebeu uma resposta incompatível. Revise o projeto.',
        false,
      );
    const reply = parsed.data;
    if (!reply.ok)
      throw new FlowRunError(
        reply.code,
        reply.message,
        !this.sent && !reply.sent,
      );
    this.sent = true;
    this.signal.throwIfAborted();
    return reply.value;
  }

  async video(
    projectId: string,
    operationId: string,
  ): Promise<{ mediaId: string; url: string }> {
    const deadline = Date.now() + 900000;
    for (let round = 0; Date.now() < deadline; round++) {
      await wait(5000, this.signal);
      let inspect = round % 3 === 0;
      try {
        const operation = await this.rpc({
          rpcId: 'jwpduf',
          projectId,
          operationId,
          payload: [null, null, [[operationId]]],
        });
        inspect ||= operation.status === 'CAE';
      } catch (error) {
        if (
          error instanceof FlowRunError &&
          ['flow_response_invalid', 'flow_rpc_rejected'].includes(error.code)
        )
          inspect = true;
        else throw error;
      }
      if (!inspect) continue;
      const media = await this.rpc({
        rpcId: 'Zzl0ze',
        projectId,
        operationId,
        payload: [`projects/${projectId}`, null, null, null, [1]],
      });
      if (!media.mediaId) continue;
      const resolved = await this.rpc({
        rpcId: 'as29s',
        projectId,
        mediaId: media.mediaId,
        payload: [media.mediaId],
      });
      if (resolved.videoUrl)
        return { mediaId: media.mediaId, url: resolved.videoUrl };
    }
    throw new FlowRunError(
      'flow_video_timeout',
      'O vídeo ainda não foi localizado. Revise o projeto antes de gerar novamente.',
      false,
    );
  }
}

async function prepareFrame(
  runner: FlowRunner,
  command: FlowExecute,
  signal: AbortSignal,
  events: FrameEvents,
): Promise<string> {
  if (command.flow.imageSourceTaskKey) {
    if (!command.sourceImage)
      throw new FlowRunError(
        'source_image_missing',
        'A imagem de origem não está confirmada. Este take não gerou outra imagem.',
        true,
      );
    events.submitted();
    events.generating();
    events.checkpoint({
      stage: 'image_reused',
      mediaId: command.sourceImage.mediaId,
      sourceTaskId: command.sourceImage.taskId,
    });
    return command.sourceImage.mediaId;
  }
  let base64: string;
  try {
    base64 = await loadReference(command.flow.reference);
  } catch {
    throw new FlowRunError(
      'flow_reference_missing',
      'A referência original não foi encontrada ou mudou nesta extensão.',
      true,
    );
  }
  const uploaded = await runner.rpc(uploadRequest(command.flow, base64));
  const referenceId = flowIdSchema.parse(uploaded.mediaId);
  events.submitted();
  events.checkpoint({ stage: 'reference_uploaded', mediaId: referenceId });
  events.generating();
  await wait(3000, signal);
  const generated = await runner.rpc(
    imageRequest(command.flow, command.original.imagePrompt, referenceId),
  );
  const imageId = flowIdSchema.parse(generated.mediaId);
  events.checkpoint({ stage: 'image_generated', mediaId: imageId });
  return imageId;
}

export async function runFlowTake(
  command: FlowExecute,
  signal: AbortSignal,
  emit: Emit,
): Promise<void> {
  const { flow, original, taskId, attemptId } = command;
  const runner = new FlowRunner(
    await projectTab(flow.projectId, Boolean(flow.batchId)),
    signal,
  );
  const base = {
    type: 'queue-progress' as const,
    taskId,
    attemptId,
    generationId: `flow-${attemptId}`,
  };
  const checkpoint = (event: CheckpointBody): void =>
    emit({
      type: 'queue-checkpoint',
      taskId,
      attemptId,
      ...event,
    } as QueueCheckpoint);
  const imageId = await prepareFrame(runner, command, signal, {
    submitted: (): void => emit({ ...base, state: 'submitted' }),
    generating: (): void => emit({ ...base, state: 'generating' }),
    checkpoint,
  });
  await wait(3000, signal);
  const video = await runner.rpc(
    videoRequest(flow, original.videoPrompt, imageId),
  );
  const operationId = flowIdSchema.parse(video.operationId);
  checkpoint({ stage: 'video_submitted', operationId });
  const ready = await runner.video(flow.projectId, operationId);
  checkpoint({ stage: 'video_ready', mediaId: ready.mediaId });
  emit({ ...base, state: 'download_pending' });
  const download = await downloadVideo(
    ready.url,
    taskId,
    signal,
    async (downloadId) => {
      checkpoint({ stage: 'download_started', downloadId });
    },
    flow.output,
  ).catch((error: unknown): never => {
    throw new FlowRunError(
      'flow_download_failed',
      error instanceof FlowDownloadError
        ? error.message
        : 'Não foi possível confirmar o download no Chrome. Confira a pasta de downloads.',
      false,
    );
  });
  signal.throwIfAborted();
  emit({
    ...base,
    state: 'completed',
    result: flowResultSchema.parse({
      simulated: false,
      ...download,
      imageMediaId: imageId,
      videoMediaId: ready.mediaId,
      operationId,
      description: 'Vídeo gerado no Flow e download concluído pelo Chrome.',
    }),
  });
}
