import {
  flowIdSchema,
  flowResultSchema,
  type FlowExecute,
  type QueueProgress,
  type QueueCheckpoint,
} from '@flow-batch/protocol';
import { z } from 'zod';
import { loadReference } from './flow-assets.js';
import { type FlowRpcRequest, type FlowRpcValue } from './flow-rpc-page.js';
import { readSourceFrame } from './flow-source-frame.js';
import { callFlowRpc } from './flow-rpc.js';
import { uploadRequest, imageRequest, videoRequest } from './flow-payloads.js';
import { downloadVideo, FlowDownloadError } from './flow-download.js';
import {
  isFlowProject,
  openProject,
  reloadFlowProject,
} from './flow-projects.js';

export class FlowRunError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly notSubmitted: boolean,
    readonly confirmedFailure = false,
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
      sourceFound: z.boolean().optional(),
      sourceOperationId: flowIdSchema.optional(),
      outcomeCode: z.number().int().min(0).max(999).optional(),
      complaint: z
        .enum(['media_not_found', 'unsafe_generation', 'other'])
        .optional(),
      imageAvailable: z.boolean().optional(),
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
type VideoReadRequest = FlowRpcRequest & {
  rpcId: 'jwpduf' | 'Zzl0ze' | 'as29s';
};
const videoReadBackoff = [0, 5000, 10000, 20000] as const;

function isTransientVideoRead(error: unknown): boolean {
  return (
    error instanceof FlowRunError &&
    [
      'flow_http_transient',
      'flow_request_unknown',
      'flow_rpc_rejected',
      'flow_operation_not_found',
      'flow_response_invalid',
    ].includes(error.code)
  );
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
  const matching = tabs.filter((tab) => isFlowProject(tab.url, projectId));
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
      raw = await callFlowRpc(this.tabId, request);
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
    if (
      reply.value.outcomeCode === 4 &&
      reply.value.complaint === 'unsafe_generation'
    )
      throw new FlowRunError(
        'flow_unsafe_generation',
        'O Flow recusou este take na verificação de segurança (PUBLIC_ERROR_UNSAFE_GENERATION). Revise o conteúdo do take antes de autorizar outra tentativa.',
        false,
        true,
      );
    this.signal.throwIfAborted();
    return reply.value;
  }

  async sourceFrame(projectId: string, storedId: string): Promise<string> {
    this.signal.throwIfAborted();
    const frame = await readSourceFrame(this.tabId, projectId, storedId).catch(
      () => {
        throw new FlowRunError(
          'source_image_lookup_failed',
          'Não foi possível consultar a imagem de origem no projeto. O vídeo ainda não foi enviado.',
          true,
        );
      },
    );
    this.signal.throwIfAborted();
    if (!frame.ok)
      throw new FlowRunError('source_image_lookup_failed', frame.message, true);
    return frame.mediaId;
  }

  async video(
    projectId: string,
    operationId: string,
  ): Promise<{ mediaId: string; url: string }> {
    const deadline = Date.now() + 900000;
    for (let round = 0; Date.now() < deadline; round++) {
      await wait(
        Math.min(5000, Math.max(0, deadline - Date.now())),
        this.signal,
      );
      if (Date.now() >= deadline) break;
      const status = await this.videoStatus(projectId, operationId, deadline);
      if (status?.videoUrl && status.mediaId)
        return { mediaId: status.mediaId, url: status.videoUrl };
      if (
        status &&
        status.status !== 'CAE' &&
        status.outcomeCode !== 3 &&
        round % 3 !== 0
      )
        continue;
      const media = await this.readVideoAsset(
        {
          rpcId: 'Zzl0ze',
          projectId,
          operationId,
          payload: [`projects/${projectId}`, null, null, null, [1]],
        },
        deadline,
      );
      if (!media.mediaId) continue;
      if (media.videoUrl)
        return { mediaId: media.mediaId, url: media.videoUrl };
      const resolved = await this.readVideoAsset(
        {
          rpcId: 'as29s',
          projectId,
          mediaId: media.mediaId,
          operationId: media.operationId ?? operationId,
          payload: [media.operationId ?? media.mediaId],
        },
        deadline,
      );
      if (resolved.videoUrl)
        return { mediaId: media.mediaId, url: resolved.videoUrl };
    }
    throw new FlowRunError(
      'flow_video_timeout',
      'O vídeo ainda não foi localizado. Revise o projeto antes de gerar novamente.',
      false,
    );
  }

  private readVideo(
    request: VideoReadRequest,
    deadline: number,
  ): Promise<FlowRpcValue> {
    const remaining = Math.max(1, deadline - Date.now());
    return this.rpc({ ...request, timeoutMs: Math.min(120000, remaining) });
  }

  private async videoStatus(
    projectId: string,
    operationId: string,
    deadline: number,
  ): Promise<FlowRpcValue | undefined> {
    try {
      return await this.readVideo(
        {
          rpcId: 'jwpduf',
          projectId,
          operationId,
          payload: [null, null, [[operationId]]],
        },
        deadline,
      );
    } catch (error) {
      if (isTransientVideoRead(error)) return undefined;
      throw error;
    }
  }

  private async readVideoAsset(
    request: VideoReadRequest & { rpcId: 'Zzl0ze' | 'as29s' },
    deadline: number,
  ): Promise<FlowRpcValue> {
    for (const delay of videoReadBackoff) {
      if (Date.now() + delay >= deadline) break;
      if (delay) await wait(delay, this.signal);
      if (Date.now() >= deadline) break;
      try {
        return await this.readVideo(request, deadline);
      } catch (error) {
        if (!isTransientVideoRead(error)) throw error;
      }
    }
    const listing = request.rpcId === 'Zzl0ze';
    throw new FlowRunError(
      listing ? 'flow_video_lookup_failed' : 'flow_video_url_lookup_failed',
      listing
        ? 'O vídeo foi enviado, mas o Flow não confirmou a leitura do projeto. Confira o vídeo no Flow antes de autorizar outra geração.'
        : 'O Flow não confirmou o vídeo nem forneceu o link. Confira o resultado desta tentativa no projeto.',
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
  if (command.sourceImage) {
    const frameId = await runner.sourceFrame(
      command.flow.projectId,
      command.sourceImage.mediaId,
    );
    events.submitted();
    events.generating();
    events.checkpoint({
      stage: 'image_reused',
      mediaId: command.sourceImage.mediaId,
      sourceTaskId: command.sourceImage.taskId,
    });
    return frameId;
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
  const tabId = await projectTab(flow.projectId, Boolean(flow.batchId));
  if (command.attemptNumber > 1) {
    try {
      await reloadFlowProject(tabId, flow.projectId, signal);
    } catch {
      throw new FlowRunError(
        'flow_retry_reload_failed',
        'A aba do projeto não ficou pronta após recarregar. Abra o projeto no Flow antes de autorizar outra tentativa.',
        true,
      );
    }
  }
  const runner = new FlowRunner(tabId, signal);
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
      imageMediaId: command.sourceImage?.mediaId ?? imageId,
      videoMediaId: ready.mediaId,
      operationId,
      description: 'Vídeo gerado no Flow e download concluído pelo Chrome.',
    }),
  });
}
