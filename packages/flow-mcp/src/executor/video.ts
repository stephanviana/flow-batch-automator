import { EventEmitter, on } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { Page, Response } from 'playwright-core';
import { readFlowPayload } from '@flow-batch/protocol';
import { decodeEnvelope, flowResponseRpcIds } from './response.js';
import { ExecutionError } from './errors.js';

const STATUS_RPCS = ['jwpduf', 'Zzl0ze', 'as29s'] as const;
const VIDEO_TIMEOUT_MS = 900_000;

interface VideoAsset {
  mediaId: string;
  url: string;
}

interface VideoStatusResponse {
  ids: string[];
  body: string;
}

function readVideoStatus(
  { ids, body }: VideoStatusResponse,
  projectId: string,
  operationId: string,
): VideoAsset | undefined {
  for (const rpcId of STATUS_RPCS) {
    if (!ids.includes(rpcId)) continue;
    let payload: unknown[];
    try {
      payload = decodeEnvelope(body, rpcId);
    } catch {
      continue;
    }
    const parsed = readFlowPayload(
      { rpcId, projectId, operationId, payload: [] },
      payload,
    );
    if (!parsed.ok || parsed.value.operationId !== operationId) continue;
    const result = parsed.value;
    if (result.outcomeCode === 4 && result.complaint === 'unsafe_generation')
      throw new ExecutionError(
        'flow_unsafe_generation',
        'O Flow recusou o conteúdo do take. Solicite revisão no chat.',
        false,
        true,
      );
    if (result.mediaId && result.videoUrl)
      return { mediaId: result.mediaId, url: result.videoUrl };
  }
}

async function readVideoResponses(
  responses: AsyncIterable<[VideoStatusResponse]>,
  projectId: string,
  operationId: string,
  signal: AbortSignal,
): Promise<VideoAsset> {
  for await (const [response] of responses) {
    signal.throwIfAborted();
    const video = readVideoStatus(response, projectId, operationId);
    if (video) return video;
  }
  throw new Error('Flow video observation ended without a result');
}

function observeStatusResponses(
  page: Page,
  signal: AbortSignal,
): { responses: AsyncIterable<[VideoStatusResponse]>; dispose: () => void } {
  const events = new EventEmitter<{ response: [VideoStatusResponse] }>();
  const responses = on(events, 'response', { signal }) as AsyncIterable<
    [VideoStatusResponse]
  >;
  const receive = (response: Response): void => {
    const ids = flowResponseRpcIds(response);
    if (!response.ok() || !STATUS_RPCS.some((id) => ids.includes(id))) return;
    void response.text().then(
      (body) => {
        if (!signal.aborted) events.emit('response', { ids, body });
      },
      () => {},
    );
  };
  page.on('response', receive);
  return {
    responses,
    dispose: (): void => {
      page.off('response', receive);
    },
  };
}

export async function observeVideo(
  page: Page,
  projectId: string,
  signal: AbortSignal,
  submit: () => Promise<string>,
): Promise<{ operationId: string; video: VideoAsset }> {
  signal.throwIfAborted();
  const lifecycle = new AbortController();
  const observation = AbortSignal.any([signal, lifecycle.signal]);
  const { responses, dispose } = observeStatusResponses(page, observation);
  const closed = (): void =>
    lifecycle.abort(
      new ExecutionError(
        'flow_video_unconfirmed',
        'A aba do Flow foi fechada durante a confirmação do vídeo.',
        false,
      ),
    );
  page.once('close', closed);
  try {
    const operationId = await submit();
    observation.throwIfAborted();
    const timeout = delay(VIDEO_TIMEOUT_MS, undefined, {
      signal: observation,
    }).then(() => {
      throw new ExecutionError(
        'flow_video_timeout',
        'O vídeo enviado não foi confirmado. Confira o resultado no Flow antes de repetir.',
        false,
      );
    });
    const video = await Promise.race([
      readVideoResponses(responses, projectId, operationId, observation),
      timeout,
    ]);
    return { operationId, video };
  } catch (error) {
    observation.throwIfAborted();
    throw error;
  } finally {
    dispose();
    page.off('close', closed);
    lifecycle.abort();
  }
}
