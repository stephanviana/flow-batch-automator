import type { Page, Response } from 'playwright-core';
import {
  readFlowPayload,
  type FlowRpcRequest,
  type FlowRpcValue,
} from '@flow-batch/protocol';
import { ExecutionError } from './errors.js';

export function flowResponseRpcIds(response: Response): string[] {
  const url = new URL(response.url());
  return url.origin === 'https://flow.google.com' &&
    url.pathname === '/_/AiSandboxAngularFrontend/data/batchexecute'
    ? (url.searchParams.get('rpcids') ?? '').split(',')
    : [];
}

export function decodeEnvelope(text: string, rpcId: string): unknown[] {
  if (text.length > 32_000_000)
    throw new ExecutionError(
      'flow_response_large',
      'A resposta do Flow excedeu o limite de leitura.',
      false,
    );
  for (const line of text.split('\n')) {
    if (!line.startsWith('[')) continue;
    let entries: unknown;
    try {
      entries = JSON.parse(line);
    } catch {
      continue;
    }
    if (!Array.isArray(entries)) continue;
    for (const entry of entries as unknown[]) {
      if (!Array.isArray(entry) || entry[0] !== 'wrb.fr' || entry[1] !== rpcId)
        continue;
      const error = JSON.stringify(entry[5] ?? '');
      if (error.includes('PUBLIC_ERROR_UNSAFE_GENERATION'))
        throw new ExecutionError(
          'flow_unsafe_generation',
          'O Flow recusou o conteúdo deste take. Solicite revisão no chat.',
          false,
          true,
        );
      if (error.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY'))
        throw new ExecutionError(
          'flow_unusual_activity',
          'O Flow recusou a atividade. Confira o navegador antes de outra tentativa.',
          false,
        );
      if (typeof entry[2] !== 'string') break;
      const payload: unknown = JSON.parse(entry[2]);
      if (Array.isArray(payload)) return payload;
    }
  }
  throw new ExecutionError(
    'flow_response_invalid',
    'O Flow não confirmou a operação enviada. Confira o projeto antes de qualquer repetição.',
    false,
  );
}

function describeUrlKind(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('https://')) return null;
  try {
    const url = new URL(value);
    const prefix = url.pathname.split('/').slice(0, 2).join('/');
    return `${url.hostname}${prefix}${url.search ? '?q' : ''}`;
  } catch {
    return null;
  }
}

function collectUrlKinds(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 6 || out.size >= 4) return;
  const kind = describeUrlKind(value);
  if (kind) {
    out.add(kind);
    return;
  }
  if (Array.isArray(value))
    for (const item of value) collectUrlKinds(item, out, depth + 1);
}

export function summarizeInvalidPayload(
  payload: unknown[],
  projectId: string,
): string {
  const top = payload
    .slice(0, 4)
    .map((entry) =>
      Array.isArray(entry) ? `a(${entry.length})` : typeof entry,
    )
    .join(',');
  const urls = new Set<string>();
  collectUrlKinds(payload, urls);
  const firstList = payload.find(
    (entry) => Array.isArray(entry) && entry.length > 0,
  ) as unknown[] | undefined;
  const rec =
    firstList && Array.isArray(firstList[0])
      ? (firstList[0] as unknown[])
      : undefined;
  const scope = rec
    ? rec[1] === projectId
      ? 'proj'
      : rec[1] == null
        ? 'null'
        : 'other'
    : 'none';
  const img = rec && Array.isArray(rec[6]) ? (rec[6] as unknown[]) : undefined;
  const dims = img && Array.isArray(img[2]) ? img[2].length : 0;
  return `top=[${top}] scope=${scope} rLen=${rec?.length ?? 0} r2=${typeof rec?.[2] === 'string'} dims=${dims} urls=${[...urls].join('|') || 'none'}`;
}

export async function observeAction(
  page: Page,
  request: Omit<FlowRpcRequest, 'payload'>,
  action: () => Promise<void>,
  signal: AbortSignal,
): Promise<FlowRpcValue> {
  signal.throwIfAborted();
  let dispose = (): void => {};
  const waiting = new Promise<Response>((resolve, reject) => {
    const fail = (): void =>
      reject(
        new ExecutionError(
          'flow_response_unconfirmed',
          'A resposta não foi confirmada após a intenção de envio. Confira o projeto antes de repetir.',
          false,
        ),
      );
    const receive = (response: Response): void => {
      if (flowResponseRpcIds(response).includes(request.rpcId))
        resolve(response);
    };
    const timeout = setTimeout(fail, 120000);
    page.on('response', receive);
    page.once('close', fail);
    signal.addEventListener('abort', fail, { once: true });
    dispose = (): void => {
      clearTimeout(timeout);
      page.off('response', receive);
      page.off('close', fail);
      signal.removeEventListener('abort', fail);
    };
  });
  void waiting.catch(() => {});
  try {
    await action();
    const response = await waiting;
    if (!response.ok())
      throw new ExecutionError(
        'flow_http_error',
        'O Flow não confirmou a operação. Confira o projeto antes de repetir.',
        false,
      );
    const payload = decodeEnvelope(await response.text(), request.rpcId);
    const parsed = readFlowPayload({ ...request, payload: [] }, payload);
    if (!parsed.ok)
      throw new ExecutionError(
        parsed.code,
        `${parsed.message} (${summarizeInvalidPayload(payload, request.projectId)})`,
        false,
      );
    signal.throwIfAborted();
    return parsed.value;
  } finally {
    dispose();
  }
}
