import {
  taskDetailSchema,
  type FlowTakeCheck,
  type TaskDetail,
} from '@flow-batch/protocol';
import { signedRequest } from './api.js';
import { FlowInputError } from './flow-errors.js';
import { isFlowProject } from './flow-projects.js';
import type { FlowRpcReply } from './flow-rpc-page.js';
import { readSourceFrame } from './flow-source-frame.js';
import { sameId } from './flow-media-id.js';
import { auditListing, auditMessage } from './flow-listing-audit.js';
import { readFlowPayload } from './flow-rpc-read.js';
import { callFlowRpc, callFlowTransport } from './flow-rpc.js';

function submittedAttempt(detail: TaskDetail): {
  attemptId: string;
  attemptNumber: number;
  operationId: string;
  sourceMediaId: string | undefined;
  sourceTaskId: string | undefined;
} {
  const attempt = detail.attempts.at(-1);
  const checkpoints = detail.checkpoints.filter(
    ({ checkpoint }) => checkpoint.attemptId === attempt?.id,
  );
  const submitted = checkpoints.find(
    ({ checkpoint }) => checkpoint.stage === 'video_submitted',
  )?.checkpoint;
  if (!attempt || submitted?.stage !== 'video_submitted')
    throw new FlowInputError(
      'Esta tentativa ainda não possui envio de vídeo registrado.',
    );
  const frame = checkpoints.find(
    ({ checkpoint }) =>
      checkpoint.stage === 'image_reused' ||
      checkpoint.stage === 'image_generated',
  )?.checkpoint;
  const sourceMediaId = frame && 'mediaId' in frame ? frame.mediaId : undefined;
  return {
    attemptId: attempt.id,
    attemptNumber: attempt.number,
    operationId: submitted.operationId,
    sourceMediaId,
    sourceTaskId:
      frame?.stage === 'image_reused' ? frame.sourceTaskId : undefined,
  };
}

function isUnsafeGeneration(reply: FlowRpcReply): boolean {
  return (
    reply.ok &&
    reply.value.outcomeCode === 4 &&
    reply.value.complaint === 'unsafe_generation'
  );
}

function describeResult(
  operation: FlowRpcReply,
  listing: FlowRpcReply,
): string {
  if (isUnsafeGeneration(operation))
    return 'O Flow confirmou a falha deste take na verificação de segurança (PUBLIC_ERROR_UNSAFE_GENERATION). Revise o conteúdo antes de autorizar outra tentativa.';
  const status = operation.ok
    ? `Operação: ${operation.value.status || 'sem estado'}${operation.value.outcomeCode === undefined ? '' : `; código ${operation.value.outcomeCode}`}${operation.value.complaint === 'media_not_found' ? '; mídia não encontrada' : operation.value.complaint ? '; aviso do Flow' : ''}.`
    : `Consulta da operação: ${operation.code}. ${operation.message}`;
  const video =
    (operation.ok && operation.value.videoUrl) ||
    (listing.ok && listing.value.videoUrl)
      ? 'arquivo disponível'
      : listing.ok && listing.value.mediaId
        ? 'registro localizado; arquivo ainda não confirmado'
        : 'não localizado';
  const result = listing.ok
    ? `Vídeo desta tentativa: ${video}.`
    : `Consulta do projeto: ${listing.code}.`;
  return `${result} ${status}`;
}

async function describeFrame(
  clientId: string,
  tabId: number,
  projectId: string,
  sourceMediaId: string,
  sourceTaskId?: string,
): Promise<string> {
  const frame = await readSourceFrame(tabId, projectId, sourceMediaId);
  if (!frame.ok) return ` Imagem de origem: ${frame.message}`;
  const location =
    frame.via === 'tile'
      ? 'Imagem localizada no cartão do projeto.'
      : 'Imagem de origem na listagem: localizada. Consulta direta da imagem: acessível.';
  const frameId = sameId(frame.mediaId, sourceMediaId)
    ? 'mesmo ID da imagem registrada'
    : 'ID de mídia corrigido pelo projeto';
  const video = sourceTaskId
    ? await checkSourceVideo(
        clientId,
        tabId,
        projectId,
        sourceTaskId,
        frame.mediaId,
      ).catch(() => ' Vídeo de origem: leitura inconclusiva.')
    : '';
  return ` ${location} Frame para o vídeo: ${frameId}.${video}`;
}

async function checkSourceVideo(
  clientId: string,
  tabId: number,
  projectId: string,
  sourceTaskId: string,
  frameId: string,
): Promise<string> {
  const source = taskDetailSchema.parse(
    await signedRequest(clientId, 'POST', '/api/queue/task', {
      taskId: sourceTaskId,
    }),
  );
  const result = source.task.result;
  if (
    source.input.executor !== 'google-flow' ||
    source.input.flow.projectId !== projectId ||
    !result ||
    result.simulated
  )
    return '';
  // The generating take used this image in its own completed video.
  const listing = await callFlowRpc(tabId, {
    rpcId: 'Zzl0ze',
    projectId,
    operationId: result.operationId,
    payload: [`projects/${projectId}`, null, null, null, [1]],
    timeoutMs: 20000,
  });
  const lookup = listing.ok
    ? (listing.value.operationId ?? listing.value.mediaId ?? result.operationId)
    : result.operationId;
  const clip = await callFlowRpc(tabId, {
    rpcId: 'as29s',
    projectId,
    operationId: lookup,
    mediaId: result.videoMediaId,
    sourceMediaId: frameId,
    payload: [lookup],
    timeoutMs: 20000,
  });
  if (!clip.ok || !clip.value.videoUrl)
    return ' Vídeo de origem: leitura inconclusiva.';
  return clip.value.sourceFound === true
    ? ' Frame confirmado no pedido do vídeo de origem.'
    : ' MP4 de origem acessível.';
}

export async function checkFlowTake(
  clientId: string,
  taskId: string,
): Promise<FlowTakeCheck> {
  const detail = taskDetailSchema.parse(
    await signedRequest(clientId, 'POST', '/api/queue/task', { taskId }),
  );
  if (detail.input.executor !== 'google-flow')
    throw new FlowInputError('Este take não possui operação no Flow.');
  const { attemptId, attemptNumber, operationId, sourceMediaId, sourceTaskId } =
    submittedAttempt(detail);
  const projectId = detail.input.flow.projectId;
  const tabs = await chrome.tabs.query({
    url: 'https://flow.google.com/*',
    discarded: false,
  });
  const tab = tabs.find((candidate) => isFlowProject(candidate.url, projectId));
  if (tab?.id === undefined)
    throw new FlowInputError(
      'Abra o projeto deste take no Flow para verificar o resultado.',
    );
  const tabId = tab.id;
  const listingRequest = {
    rpcId: 'Zzl0ze' as const,
    projectId,
    operationId,
    ...(sourceMediaId ? { sourceMediaId } : {}),
    payload: [`projects/${projectId}`, null, null, null, [1]],
    timeoutMs: 20000,
  };
  const response = await callFlowTransport(tabId, listingRequest);
  const listing = response.ok
    ? readFlowPayload(listingRequest, response.payload)
    : response;
  const audit = response.ok
    ? auditMessage(
        auditListing(
          response.payload,
          projectId,
          detail.input.original.videoPrompt,
          operationId,
          sourceMediaId,
        ),
        operationId,
      )
    : '';

  const workflowId = listing.ok
    ? (listing.value.operationId ?? listing.value.mediaId ?? operationId)
    : operationId;
  const status = await callFlowRpc(tabId, {
    rpcId: 'jwpduf',
    projectId,
    operationId,
    payload: [null, null, [[operationId]]],
    timeoutMs: 20000,
  });
  const operation = isUnsafeGeneration(status)
    ? status
    : await callFlowRpc(tabId, {
        rpcId: 'as29s',
        projectId,
        operationId: workflowId,
        ...(listing.ok && listing.value.mediaId
          ? { mediaId: listing.value.mediaId }
          : {}),
        payload: [workflowId],
        timeoutMs: 20000,
      });
  const frameReport = sourceMediaId
    ? await describeFrame(
        clientId,
        tabId,
        projectId,
        sourceMediaId,
        sourceTaskId === taskId ? undefined : sourceTaskId,
      ).catch(() => ' Imagem de origem: consulta inconclusiva.')
    : '';
  const details = isUnsafeGeneration(operation)
    ? frameReport
    : ` ${audit}${audit ? (frameReport.includes('acessível') || frameReport.includes('cartão') ? ' Imagem de origem na listagem: localizada. Consulta direta da imagem: acessível.' : '') : frameReport}`;
  return {
    taskId,
    attemptId,
    checkedAt: Date.now(),
    message: `Tentativa ${attemptNumber}. ${describeResult(operation, listing)}${details} Consulta sem gerar nova mídia.`,
  };
}
