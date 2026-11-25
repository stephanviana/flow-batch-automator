import type { McpServer, CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { FlowBrowserError } from '../contracts.js';
import type { ExecutorControl } from './control.js';

async function reply(
  operation: () => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    return {
      content: [{ type: 'text', text: JSON.stringify(await operation()) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code:
              error instanceof FlowBrowserError
                ? error.code
                : 'executor_unavailable',
            message:
              error instanceof FlowBrowserError
                ? error.message
                : 'O executor local não confirmou a operação. Consulte a conexão e a fila.',
          }),
        },
      ],
    };
  }
}

export function registerExecutorTools(
  server: McpServer,
  executor: ExecutorControl,
): void {
  server.registerTool(
    'flow_browser_pair',
    {
      description:
        'Solicita a conexão do executor local. Mostra código e URL /connect para confirmação explícita do usuário; não aprova a conexão nem gera mídia.',
      inputSchema: z.strictObject({}),
      annotations: { destructiveHint: false },
    },
    () => reply(() => executor.pair()),
  );
  server.registerTool(
    'flow_browser_executor_status',
    {
      description:
        'Consulta identidade, autorização e conexão do executor local, sem criar identidade, iniciar processo ou gerar mídia.',
      inputSchema: z.strictObject({}),
      annotations: { readOnlyHint: true },
    },
    () => reply(() => executor.status()),
  );
  server.registerTool(
    'flow_browser_start_worker',
    {
      description:
        'Inicia o executor já autorizado em /connect. Pode executar pedidos previamente autorizados no chat e destinados a este clientId; nunca use isso para substituir a autorização de publicação do pedido.',
      inputSchema: z.strictObject({}),
      annotations: { destructiveHint: true },
    },
    () => reply(() => executor.start()),
  );
  server.registerTool(
    'flow_browser_pause_worker',
    {
      description:
        'Pausa o início dos próximos takes e o recebimento de despachos anteriores à pausa. Um take já enviado pode terminar; não interrompe nem repete gerações.',
      inputSchema: z.strictObject({}),
      annotations: { destructiveHint: false },
    },
    () => reply(() => executor.pause()),
  );
}
