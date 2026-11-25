import type { Page, Response } from 'playwright-core';
import {
  readFlowPayload,
  type FlowRpcRequest,
  type FlowRpcValue,
} from '@flow-batch/protocol';
import { ExecutionError } from './errors.js';

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
      const url = new URL(response.url());
      if (
        url.origin === 'https://flow.google.com' &&
        url.pathname === '/_/AiSandboxAngularFrontend/data/batchexecute' &&
        (url.searchParams.get('rpcids') ?? '')
          .split(',')
          .includes(request.rpcId)
      )
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
    const parsed = readFlowPayload(
      { ...request, payload: [] },
      decodeEnvelope(await response.text(), request.rpcId),
    );
    if (!parsed.ok)
      throw new ExecutionError(parsed.code, parsed.message, false);
    signal.throwIfAborted();
    return parsed.value;
  } finally {
    dispose();
  }
}
