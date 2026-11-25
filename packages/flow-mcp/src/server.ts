import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  assetInputSchema,
  findImageInputSchema,
  projectInputSchema,
  FlowBrowserError,
} from './contracts.js';
import type { FlowBrowserService } from './service.js';
import type { ExecutorControl } from './executor/control.js';
import { registerExecutorTools } from './executor/tools.js';

async function reply(
  operation: () => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    return {
      content: [{ type: 'text', text: JSON.stringify(await operation()) }],
    };
  } catch (error) {
    // Playwright errors can contain signed media URLs or complete page logs.
    const failure =
      error instanceof FlowBrowserError
        ? { code: error.code, message: error.message }
        : {
            code: 'browser_operation_failed',
            message:
              'Não foi possível concluir a consulta. Confira a janela dedicada e tente uma nova consulta.',
          };
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(failure) }],
    };
  }
}

export function createBrowserMcpServer(
  service: FlowBrowserService,
  executor?: ExecutorControl,
): McpServer {
  const server = new McpServer(
    { name: 'flow-browser', version: '0.1.0' },
    {
      instructions:
        'Google Flow em Chrome dedicado. flow_browser_login abre o navegador comum para login manual; após concluir e fechar essa janela, flow_browser_connect conecta o mesmo perfil. Consulte imagens pelos IDs, nunca pelos títulos. Para executar pedidos, conecte o executor com flow_browser_pair e obtenha a confirmação do usuário em /connect; flow_browser_start_worker recebe apenas entradas imutáveis e autorizadas pela fila. Prepare conteúdo pelo MCP flow-batch e publique com a autorização do usuário, escolhendo o clientId retornado por flow_browser_executor_status. Iniciar o worker não autoriza novos pedidos, revisões ou repetições. Nunca envie prompts por atalhos fora da fila.',
    },
  );
  server.registerTool(
    'flow_browser_connect',
    {
      description:
        'Após o login manual e o fechamento dessa janela pelo usuário, abre o Chrome com o mesmo perfil e conecta o controle. Não gera mídia. Recusa enquanto o login manual estiver aberto.',
      inputSchema: z.strictObject({}),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    () => reply(() => service.connectSession()),
  );
  server.registerTool(
    'flow_browser_login',
    {
      description:
        'Abre ou reutiliza o Chrome dedicado para o usuário fazer login manualmente no Flow. Não preenche senha ou códigos, não solicita credenciais pelo chat e não gera mídia.',
      inputSchema: z.strictObject({}),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    () => reply(() => service.login()),
  );
  server.registerTool(
    'flow_browser_status',
    {
      description:
        'Consulta a sessão e o projeto já aberto, sem iniciar Chrome, navegar ou gerar mídia.',
      inputSchema: z.strictObject({}),
      annotations: { readOnlyHint: true },
    },
    () => reply(() => service.status()),
  );
  server.registerTool(
    'flow_browser_open_project',
    {
      description:
        'Abre um projeto existente na mesma aba do Chrome dedicado. Recusa navegação durante geração ou com texto no compositor. Não cria projetos.',
      inputSchema: projectInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    ({ projectId }) => reply(() => service.openProject(projectId)),
  );
  server.registerTool(
    'flow_browser_assets',
    {
      description:
        'Lista mídias com ID estável na visualização atual do projeto. Percorre a grade virtual dentro dos limites, informa cobertura e preserva a posição de rolagem. Não gera nem baixa arquivos.',
      inputSchema: assetInputSchema,
      annotations: { readOnlyHint: true },
    },
    (input) => reply(() => service.assets(input)),
  );
  server.registerTool(
    'flow_browser_find_image',
    {
      description:
        'Confirma uma imagem existente pelo ID e projeto, com consulta limitada à visualização atual. Nunca usa título, URL assinada ou geração de fallback como identidade.',
      inputSchema: findImageInputSchema,
      annotations: { readOnlyHint: true },
    },
    (input) => reply(() => service.findImage(input)),
  );
  if (executor) registerExecutorTools(server, executor);
  return server;
}
