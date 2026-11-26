import { setTimeout as delay } from 'node:timers/promises';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { AgentApi } from '../agent-client/http.js';
import type { OrderMonitoringSnapshot } from '../orders/monitor.js';
import { result } from './result.js';
import { ORDER_MONITORING_POLICY } from '../agent-client/workflow.js';

const CHECK_INTERVAL_MS = 2000;
const QUERY_TIMEOUT_MS = 5000;

async function waitForOrder(
  api: AgentApi,
  order: string | number,
  waitSeconds: number,
  signal: AbortSignal,
): Promise<OrderMonitoringSnapshot> {
  const deadline = performance.now() + waitSeconds * 1000;
  let key = order;
  for (;;) {
    signal.throwIfAborted();
    const snapshot = await api<OrderMonitoringSnapshot>(
      `/manage/orders/${key}/monitor`,
      undefined,
      false,
      AbortSignal.any([signal, AbortSignal.timeout(QUERY_TIMEOUT_MS)]),
    );
    const remaining = deadline - performance.now();
    if (snapshot.status !== 'in_progress' || remaining <= 0) return snapshot;
    key = z.uuid().parse(snapshot.orderId);
    await delay(Math.min(CHECK_INTERVAL_MS, remaining), undefined, { signal });
  }
}

export function registerOrderMonitor(server: McpServer, api: AgentApi): void {
  server.registerTool(
    'flow_wait_order',
    {
      description:
        'Consulta somente leitura; aguarda até o pedido parar, concluir ou a janela de consulta terminar. A consulta não autoriza ou repete gerações. ' +
        ORDER_MONITORING_POLICY,
      inputSchema: z.object({
        order: z.union([z.number().int().positive(), z.uuid()]),
        waitSeconds: z.number().int().min(0).max(35).default(30),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ order, waitSeconds }, { mcpReq: { signal } }) =>
      result(() => waitForOrder(api, order, waitSeconds, signal)),
  );
}
