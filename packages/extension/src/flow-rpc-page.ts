// Adapted from FlowKit's browser transport and response readers (MIT).
// Serialized into MAIN world: runtime helpers must remain inside this function.
export interface FlowRpcRequest {
  rpcId: 'Zzl0ze';
  projectId: string;
  payload: unknown[];
}
export interface FlowRpcValue {
  ready?: boolean;
}
export type FlowRpcReply =
  | { ok: true; value: FlowRpcValue }
  | { ok: false; code: string; message: string; sent: boolean };

export async function flowRpcPage(
  request: FlowRpcRequest,
): Promise<FlowRpcReply> {
  let sent = false;
  const fail = (code: string, message: string): FlowRpcReply => ({
    ok: false,
    code,
    message,
    sent,
  });
  if (
    location.origin !== 'https://flow.google.com' ||
    location.pathname.match(/\/project\/([a-zA-Z0-9_-]+)(?:\/|$)/)?.[1] !==
      request.projectId
  )
    return fail(
      'flow_project_changed',
      'Abra o projeto selecionado no Flow e verifique novamente.',
    );
  if (
    !['maseQ', 'ogiZ0b', 'eb1hJf', 'jwpduf', 'Zzl0ze', 'as29s'].includes(
      request.rpcId,
    )
  )
    return fail('flow_rpc_invalid', 'Chamada Flow não reconhecida.');
  const page = globalThis as typeof globalThis & {
    WIZ_global_data?: Record<string, unknown>;
  };
  const metadata = page.WIZ_global_data;
  if (typeof metadata?.SNlM0e !== 'string' || !metadata.SNlM0e)
    return fail(
      'flow_session_missing',
      'Entre no Flow e aguarde o projeto carregar.',
    );
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
        signal: AbortSignal.timeout(120000),
      },
    );
    if (!response.ok)
      return fail(
        'flow_http_error',
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
        if (typeof entry[2] !== 'string')
          return fail(
            'flow_rpc_rejected',
            'O Flow recusou a leitura ou geração. Confira a sessão na aba.',
          );
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
    return { ok: true, value: { ready: true } };
  } catch {
    return fail(
      'flow_request_unknown',
      'Não foi possível confirmar a resposta do Flow. Confira o projeto antes de repetir.',
    );
  }
}
