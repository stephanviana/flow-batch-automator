import { PREPARATION_CONTRACT } from '@flow-batch/protocol';

export interface AgentApi {
  <T = unknown>(path: string, body?: unknown, binary?: false): Promise<T>;
  (path: string, body: undefined, binary: true): Promise<Buffer>;
}
export async function localClient(
  base = 'http://127.0.0.1:4319',
): Promise<AgentApi> {
  const url = new URL(base);
  if (
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.protocol !== 'http:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Use a API HTTP local sem credenciais ou caminhos adicionais.',
    );
  base = url.origin;
  let cookie = '',
    expiresAt = 0;
  async function session(): Promise<void> {
    if (Date.now() < expiresAt) return;
    const open = (): Promise<Response> =>
      fetch(`${base}/orders`, {
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
    const response = await open().catch(() => open());
    await response.arrayBuffer();
    cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
    if (!response.ok || !cookie)
      throw new Error('Não foi possível iniciar a sessão local.');
    expiresAt = Date.now() + 1_500_000;
  }
  await session();
  const api = async (
    path: string,
    body?: unknown,
    binary = false,
  ): Promise<unknown> => {
    if (
      !path.startsWith('/manage/') ||
      path.includes('..') ||
      path.includes('#')
    )
      throw new Error('Caminho de gestão inválido.');
    await session();
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(120000),
      headers: {
        cookie,
        origin: base,
        'X-Flow-Management': '1',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const error = (await response.json()) as {
        error?: string;
        issues?: { path: (string | number)[]; message: string }[];
      };
      const fields = error.issues
        ?.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('\n');
      throw new Error(
        `${error.error ?? 'Operação recusada.'} (HTTP ${response.status})${fields ? `\n${fields}` : ''}`,
      );
    }
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
  return api as AgentApi;
}
export async function requireContract(api: AgentApi): Promise<void> {
  let capabilities: { contract: string };
  try {
    capabilities = await api('/manage/agent/capabilities');
  } catch (error) {
    throw new Error(
      `O servidor não forneceu o contrato de preparação. Verifique se a aplicação foi atualizada; não adapte o JSON a um schema antigo. ${error instanceof Error ? error.message : ''}`,
      { cause: error },
    );
  }
  if (capabilities.contract !== PREPARATION_CONTRACT)
    throw new Error(
      `Contrato incompatível: cliente ${PREPARATION_CONTRACT}; servidor ${capabilities.contract}. Atualize a aplicação antes de preparar ou publicar.`,
    );
}
