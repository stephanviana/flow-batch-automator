import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { AgentApi } from '../agent-client/http.js';
import { result } from './result.js';

const order = z.union([z.number().int().positive(), z.uuid()]);
const authorize = z.literal(true);
const takeTarget = z.object({
  order,
  taskId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  userAuthorized: authorize,
});
const hash = z.string().regex(/^[a-f0-9]{64}$/);

async function orderId(api: AgentApi, key: number | string): Promise<string> {
  if (typeof key === 'string') return key;
  const current = await api<{ order: { id: string } }>(`/manage/orders/${key}`);
  return z.uuid().parse(current.order.id);
}

function registerTakeControls(server: McpServer, api: AgentApi): void {
  server.registerTool(
    'flow_cancel_take',
    {
      description:
        'Cancela somente um take pendente identificado pelo usuário. Use o taskId e a revisão atual de flow_order_diagnostics. Preserva o histórico.',
      inputSchema: takeTarget,
      annotations: { destructiveHint: true },
    },
    ({ order, taskId, expectedRevision }) =>
      result(() =>
        api(`/manage/orders/${order}/diagnostics/cancel`, {
          taskId,
          expectedRevision,
        }),
      ),
  );
  server.registerTool(
    'flow_resolve_take',
    {
      description:
        'Registra uma decisão explícita do usuário após conferir o resultado no Flow. Use flow_order_diagnostics. Use failed para falha confirmada e not_submitted somente quando houver certeza de que não houve envio. Não gera mídia nem confirma download.',
      inputSchema: takeTarget.extend({
        outcome: z.enum(['failed', 'not_submitted']),
        note: z.string().trim().min(1).max(500).optional(),
      }),
      annotations: { destructiveHint: true },
    },
    ({ order, taskId, expectedRevision, outcome, note }) =>
      result(() =>
        api(`/manage/orders/${order}/diagnostics/resolve`, {
          taskId,
          expectedRevision,
          outcome,
          note: note ?? 'Falha revisada por solicitação no chat.',
        }),
      ),
  );
  server.registerTool(
    'flow_retry_take',
    {
      description:
        'Enfileira uma nova tentativa com o conteúdo usado na última tentativa do take. Consulte flow_order_diagnostics. Exige falha confirmada após conferir o Flow e autorização explícita do usuário para a quantidade indicada de imagens e um vídeo. Uma imagem já confirmada deve ser reutilizada pelo ID com imageGenerations=0; nunca gere uma imagem de fallback. Vídeo já localizado bloqueia nova geração, inclusive quando o download falhou. Para revisar copy e prompt, use flow_prepare_take_revision. Se o resultado for incerto, resolva o take antes.',
      inputSchema: takeTarget.extend({
        requestId: z.uuid(),
        confirmedFailure: z.literal(true),
        imageGenerations: z.union([z.literal(0), z.literal(1)]),
        startQueue: z.boolean().default(false),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({
      order,
      taskId,
      expectedRevision,
      requestId,
      confirmedFailure,
      imageGenerations,
      startQueue,
    }) =>
      result(() =>
        api(`/manage/orders/${order}/diagnostics/retry`, {
          action: 'retry_flow',
          taskId,
          expectedRevision,
          requestId,
          confirmedFailure,
          approve: true,
          expectedImageGenerations: imageGenerations,
          startQueue,
        }),
      ),
  );
}

function registerOrderControls(server: McpServer, api: AgentApi): void {
  server.registerTool(
    'flow_cancel_order',
    {
      description:
        'Cancela um pedido ainda sem despacho, após solicitação do usuário. Para takes de um pedido já despachado, use flow_cancel_take.',
      inputSchema: z.object({ order, userAuthorized: authorize }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ order }) =>
      result(async () =>
        api(`/manage/orders/${await orderId(api, order)}/cancel`, {}),
      ),
  );
  server.registerTool(
    'flow_clear_orders',
    {
      description:
        'Remove da lista os pedidos elegíveis indicados pelo usuário, preservando materiais, registros e histórico. Use os UUIDs de flow_list_orders e o campo clearable. Nunca limpe pedidos como parte de outra operação.',
      inputSchema: z.object({
        orderIds: z.array(z.uuid()).min(1).max(200),
        userAuthorized: authorize,
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ orderIds }) =>
      result(() => api('/manage/orders/clear', { ids: orderIds })),
  );
  server.registerTool(
    'flow_set_auto_retry',
    {
      description:
        'Autoriza ou revoga a política de até uma tentativa extra por take em 24 horas, somente em falha comprovadamente anterior ao envio. Consulte o limite de imagens e vídeos em flow_order_diagnostics e obtenha a autorização explícita do usuário para ativar.',
      inputSchema: z.object({
        order,
        requestId: z.uuid(),
        enabled: z.boolean(),
        userAuthorized: authorize,
      }),
      annotations: { destructiveHint: true },
    },
    ({ order, requestId, enabled }) =>
      result(async () =>
        api(`/manage/orders/${await orderId(api, order)}/auto-retry`, {
          requestId,
          enabled,
        }),
      ),
  );
  server.registerTool(
    'flow_close_dispatch',
    {
      description:
        'Encerra um grupo bloqueado a pedido do usuário, preservando os resultados e impedindo novas gerações nesse grupo. Consulte flow_order_diagnostics ou flow_review_dispatch e use os hashes atuais. A operação recusa grupos com trabalho pendente, ativo ou incerto.',
      inputSchema: z.object({
        order,
        dispatchId: z.uuid(),
        reviewHash: hash,
        preparationHash: hash,
        userAuthorized: authorize,
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ order, dispatchId, reviewHash, preparationHash }) =>
      result(() =>
        api(`/manage/orders/${order}/dispatches/${dispatchId}/close`, {
          reviewHash,
          preparationHash,
          note: 'Grupo encerrado por solicitação no chat.',
        }),
      ),
  );
}

export function registerQueueTools(server: McpServer, api: AgentApi): void {
  server.registerTool(
    'flow_queue_status',
    {
      description:
        'Consulta a fila, os executores autorizados, a pausa, os números reais de takes e os despachos pendentes. Para identificar takes e MP4s de um pedido, use flow_order_diagnostics.',
      inputSchema: z.object({ clientId: z.uuid().optional() }),
      annotations: { readOnlyHint: true },
    },
    ({ clientId }) =>
      result(() =>
        api(
          clientId
            ? `/manage/executor?clientId=${clientId}`
            : '/manage/executor',
        ),
      ),
  );
  server.registerTool(
    'flow_order_diagnostics',
    {
      description:
        'Consulta um pedido pelo número atual ou UUID, incluindo takes, falhas, dependências de imagens, tentativas, MP4s confirmados e grupos bloqueados. Mostre etapas reais sem inferir conclusão ou percentual.',
      inputSchema: z.object({ order }),
      annotations: { readOnlyHint: true },
    },
    ({ order }) => result(() => api(`/manage/orders/${order}/diagnostics`)),
  );
  server.registerTool(
    'flow_queue_control',
    {
      description:
        'Pausa o início dos próximos takes ou retoma somente trabalhos já autorizados. Use somente a pedido do usuário no chat. Uma pausa não interrompe um take ativo. Consulte flow_queue_status e informe clientId quando houver múltiplos executores. A retomada só processa a fila se o flow-browser estiver conectado.',
      inputSchema: z.object({
        action: z.enum(['pause', 'resume']),
        clientId: z.uuid().optional(),
        userAuthorized: authorize,
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ action, clientId }) =>
      result(() =>
        api('/manage/executor/control', {
          action: action === 'resume' ? 'start' : 'pause',
          clientId,
        }),
      ),
  );
  registerTakeControls(server, api);
  registerOrderControls(server, api);
}
