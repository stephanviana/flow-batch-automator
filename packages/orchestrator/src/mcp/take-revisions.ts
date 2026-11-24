import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  flowRevisionApprovalSchema,
  flowRevisionPreparationSchema,
} from '@flow-batch/protocol';
import type { AgentApi } from '../agent-client/http.js';
import { result } from './result.js';
import { TAKE_REVISION_EXECUTION_POLICY } from '../agent-client/workflow.js';

export function registerTakeRevisionTools(
  server: McpServer,
  api: AgentApi,
): void {
  const task = z.object({ taskId: z.uuid() });
  server.registerTool(
    'flow_review_take',
    {
      description:
        'Consulta um take com falha, a imagem registrada, os textos efetivamente usados, tentativas, materiais e a captura integral de instruções da preparação. Leia todo o contexto. ' +
        TAKE_REVISION_EXECUTION_POLICY,
      inputSchema: task,
      annotations: { readOnlyHint: true },
    },
    ({ taskId }) => result(() => api(`/manage/takes/${taskId}/review`)),
  );
  server.registerTool(
    'flow_prepare_take_revision',
    {
      description:
        'Salva uma nova versão de copy e prompt de vídeo para um take com falha confirmada e imagem existente. Use o expectedRevision de flow_review_take e um requestId novo. Leia a captura local, preserve fatos do produto, composição da imagem, continuidade e falas de preserve-copy. ' +
        TAKE_REVISION_EXECUTION_POLICY,
      inputSchema: task.extend(flowRevisionPreparationSchema.shape).extend({
        execute: z.boolean().default(false),
        userAuthorized: z.literal(true).optional(),
        startQueue: z.boolean().default(true),
      }),
      annotations: { destructiveHint: true },
    },
    ({ taskId, execute, userAuthorized, startQueue, ...input }) =>
      result(() => {
        if (execute && !userAuthorized)
          throw new Error(
            'A execução exige o pedido de revisão e geração do usuário no chat.',
          );
        return api(`/manage/takes/${taskId}/revisions`, {
          ...input,
          ...(execute
            ? { execution: { userAuthorized: true, startQueue } }
            : {}),
        });
      }),
  );
  server.registerTool(
    'flow_approve_take_revision',
    {
      description:
        'Pode consumir créditos. Enfileira a versão revisada identificada por revisionId com zero imagens e um vídeo. Use a autorização do pedido de revisão e geração enviado no chat ou o pedido posterior de executar uma versão preparada. startQueue permite processar a fila se estiver pausada. ' +
        TAKE_REVISION_EXECUTION_POLICY,
      inputSchema: task.extend(flowRevisionApprovalSchema.shape),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    ({ taskId, ...input }) =>
      result(() => api(`/manage/takes/${taskId}/revisions/approve`, input)),
  );
}
