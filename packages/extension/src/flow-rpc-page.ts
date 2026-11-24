// Adapted from FlowKit's browser transport (MIT).
// Serialized into MAIN world: runtime helpers must remain inside this function.
import type {
  FlowRpcRequest,
  FlowRpcTransportReply,
} from './flow-rpc-contract.js';
export type {
  FlowRpcRequest,
  FlowRpcValue,
  FlowRpcReply,
} from './flow-rpc-contract.js';

export async function flowRpcPage(
  request: FlowRpcRequest,
): Promise<FlowRpcTransportReply> {
  let sent = false;
  const fail = (code: string, message: string): FlowRpcTransportReply => ({
    ok: false,
    code,
    message,
    sent,
  });
  if (
    location.origin !== 'https://flow.google.com' ||
    (request.rpcId !== 'jHPbke' &&
      location.pathname.match(/\/project\/([a-zA-Z0-9_-]+)(?:\/|$)/)?.[1] !==
        request.projectId)
  )
    return fail(
      'flow_project_changed',
      'Abra o projeto selecionado no Flow e verifique novamente.',
    );
  if (
    ![
      'maseQ',
      'ogiZ0b',
      'eb1hJf',
      'jwpduf',
      'Zzl0ze',
      'as29s',
      'jHPbke',
    ].includes(request.rpcId)
  )
    return fail('flow_rpc_invalid', 'Chamada Flow não reconhecida.');
  const page = globalThis as typeof globalThis & {
    WIZ_global_data?: Record<string, unknown>;
    __fk_hijack?: {
      pristine?: (key: string, options: { action: string }) => Promise<string>;
    };
    grecaptcha?: {
      enterprise?: {
        execute?: (key: string, options: { action: string }) => Promise<string>;
      };
    };
    ___grecaptcha_cfg?: { clients?: Record<string, { sitekey?: string }> };
  };
  const metadata = page.WIZ_global_data;
  if (typeof metadata?.SNlM0e !== 'string' || !metadata.SNlM0e)
    return fail(
      'flow_session_missing',
      'Entre no Flow e aguarde o projeto carregar.',
    );
  const within = async <T>(
    operation: Promise<T>,
    milliseconds: number,
  ): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  if (request.captchaAction) {
    try {
      const enterprise = page.grecaptcha?.enterprise;
      if (
        !page.__fk_hijack?.pristine &&
        enterprise?.execute?.toString().includes('extension_hijack_detected')
      )
        return fail(
          'flow_captcha_not_ready',
          'Recarregue o projeto após recarregar a extensão e tente novamente.',
        );
      const execute =
        page.__fk_hijack?.pristine ?? enterprise?.execute?.bind(enterprise);
      if (!execute || execute.toString().includes('extension_hijack_detected'))
        return fail(
          'flow_captcha_not_ready',
          'Recarregue o projeto após recarregar a extensão e tente novamente.',
        );
      const siteKey =
        Object.values(page.___grecaptcha_cfg?.clients ?? {}).find(
          (client) => typeof client.sitekey === 'string',
        )?.sitekey ?? '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
      const token = await within(
        execute(siteKey, { action: request.captchaAction }),
        20000,
      );
      if (typeof token !== 'string' || !token)
        return fail(
          'flow_captcha_empty',
          'O Flow não forneceu o token de verificação.',
        );
      const contexts: unknown[] =
        request.rpcId === 'maseQ'
          ? [request.payload[0]]
          : request.rpcId === 'ogiZ0b'
            ? [
                request.payload[3],
                ...(Array.isArray(request.payload[1])
                  ? request.payload[1].map((entry: unknown) =>
                      Array.isArray(entry) ? (entry[7] as unknown) : null,
                    )
                  : []),
              ]
            : [request.payload[1]];
      for (const context of contexts) {
        if (
          !Array.isArray(context) ||
          context[1] !== 22 ||
          !Array.isArray(context[10])
        )
          return fail(
            'flow_context_invalid',
            'Formato de geração incompatível.',
          );
        context[10][0] = token;
      }
    } catch {
      return fail(
        'flow_captcha_failed',
        'A verificação do Flow falhou. Confira a aba do projeto.',
      );
    }
  }
  const parameters = new URLSearchParams({
    rpcids: request.rpcId,
    'source-path': location.pathname,
    bl: typeof metadata.cfb2h === 'string' ? metadata.cfb2h : '',
    'f.sid': typeof metadata.FdrFJe === 'string' ? metadata.FdrFJe : '',
    hl:
      (document.documentElement.lang || navigator.language || 'en').split(
        '-',
      )[0] || 'en',
    _reqid: String(Math.floor(Math.random() * 900000) + 100000),
    rt: 'c',
  });
  try {
    const envelope = JSON.stringify([
      [[request.rpcId, JSON.stringify(request.payload), null, 'generic']],
    ]);
    sent = true;
    const response = await fetch(
      `/_/AiSandboxAngularFrontend/data/batchexecute?${parameters}`,
      {
        method: 'POST',
        credentials: 'include',
        redirect: 'error',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'x-same-domain': '1',
        },
        body: new URLSearchParams({ 'f.req': envelope, at: metadata.SNlM0e }),
        signal: AbortSignal.timeout(request.timeoutMs ?? 120000),
      },
    );
    if (!response.ok)
      return fail(
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500
          ? 'flow_http_transient'
          : 'flow_http_error',
        `O Flow recusou a consulta (HTTP ${response.status}).`,
      );
    const text = await response.text();
    if (text.length > 32_000_000)
      return fail(
        'flow_response_large',
        'O projeto excede o tamanho de resposta suportado.',
      );
    if (text.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY'))
      return fail(
        'flow_unusual_activity',
        'O Flow bloqueou a atividade. Confira a aba antes de tentar outra geração.',
      );
    let payload: unknown;
    for (const line of text.split('\n')) {
      if (!line.startsWith('[')) continue;
      let chunk: unknown;
      try {
        chunk = JSON.parse(line);
      } catch {
        continue;
      }
      if (!Array.isArray(chunk)) continue;
      for (const entry of chunk as unknown[]) {
        if (
          !Array.isArray(entry) ||
          entry[0] !== 'wrb.fr' ||
          entry[1] !== request.rpcId
        )
          continue;
        if (typeof entry[2] !== 'string') {
          const errorSlot: unknown = entry[5];
          const errorCode: unknown = Array.isArray(errorSlot)
            ? errorSlot[0]
            : undefined;
          if (request.rpcId === 'as29s' && errorCode === 5)
            return fail(
              'flow_operation_not_found',
              'O Flow não encontrou a operação consultada (código 5).',
            );
          const suffix =
            typeof errorCode === 'number' &&
            Number.isInteger(errorCode) &&
            errorCode >= 0 &&
            errorCode <= 999
              ? ` (código ${errorCode})`
              : '';
          return fail(
            'flow_rpc_rejected',
            `O Flow recusou a leitura ou geração${suffix}. Confira a sessão na aba.`,
          );
        }
        try {
          payload = JSON.parse(entry[2]);
        } catch {
          /* Reject malformed envelopes below. */
        }
      }
    }
    if (!Array.isArray(payload))
      return fail(
        'flow_response_invalid',
        'Resposta do Flow incompatível com o adaptador.',
      );
    return { ok: true, payload };
  } catch {
    return fail(
      'flow_request_unknown',
      'Não foi possível confirmar a resposta do Flow. Confira o projeto antes de repetir.',
    );
  }
}
