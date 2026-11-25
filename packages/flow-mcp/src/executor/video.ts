import type { Page } from 'playwright-core';
import { readFlowPayload, type FlowRpcRequest } from '@flow-batch/protocol';
import { decodeEnvelope } from './response.js';
import { ExecutionError } from './errors.js';

export async function waitForVideo(
  page: Page,
  projectId: string,
  operationId: string,
  signal: AbortSignal,
): Promise<{ mediaId: string; url: string }> {
  const deadline = Date.now() + 900000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const response = await page
      .waitForResponse(
        (candidate) => {
          const url = new URL(candidate.url());
          return (
            url.origin === 'https://flow.google.com' &&
            url.pathname === '/_/AiSandboxAngularFrontend/data/batchexecute' &&
            ['jwpduf', 'Zzl0ze', 'as29s'].some((id) =>
              (url.searchParams.get('rpcids') ?? '').split(',').includes(id),
            )
          );
        },
        { timeout: Math.min(20000, deadline - Date.now()) },
      )
      .catch(() => null);
    if (!response || !response.ok()) continue;
    const ids =
      new URL(response.url()).searchParams.get('rpcids')?.split(',') ?? [];
    const body = await response.text();
    for (const rpcId of ['jwpduf', 'Zzl0ze', 'as29s'] as const) {
      if (!ids.includes(rpcId)) continue;
      let payload: unknown[];
      try {
        payload = decodeEnvelope(body, rpcId);
      } catch (error) {
        if (error instanceof ExecutionError && error.confirmedFailure)
          throw error;
        continue;
      }
      const request: FlowRpcRequest = {
        rpcId,
        projectId,
        operationId,
        payload: [],
      };
      const parsed = readFlowPayload(request, payload);
      if (!parsed.ok) continue;
      const value = parsed.value;
      if (value.outcomeCode === 4 && value.complaint === 'unsafe_generation')
        throw new ExecutionError(
          'flow_unsafe_generation',
          'O Flow recusou o conteúdo do take. Solicite revisão no chat.',
          false,
          true,
        );
      if (value.operationId === operationId && value.mediaId && value.videoUrl)
        return { mediaId: value.mediaId, url: value.videoUrl };
    }
  }
  throw new ExecutionError(
    'flow_video_timeout',
    'O vídeo enviado não foi confirmado. Confira o resultado no Flow antes de repetir.',
    false,
  );
}
