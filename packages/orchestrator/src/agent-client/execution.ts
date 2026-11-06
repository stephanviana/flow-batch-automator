import type { OrderExecution } from '@flow-batch/protocol';
import type { AgentApi } from './http.js';

interface ExecutionClient {
  id: string;
  authorizedAt: number | null;
  revokedAt: number | null;
}
export async function orderExecution(
  api: AgentApi,
  clientId?: string,
): Promise<OrderExecution> {
  const { clients } = await api<{ clients: ExecutionClient[] }>(
    '/manage/status',
  );
  const available = clients.filter(
    (client) => client.authorizedAt !== null && client.revokedAt === null,
  );
  const selected = clientId
    ? available.find((client) => client.id === clientId)
    : available.length === 1
      ? available[0]
      : undefined;
  if (!selected)
    throw new Error(
      'Conecte uma extensão autorizada ou escolha seu clientId quando houver várias extensões.',
    );
  return { clientId: selected.id, userAuthorized: true };
}
