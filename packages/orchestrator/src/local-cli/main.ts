import { fileURLToPath } from 'node:url';
import { stateDirectory } from './config.js';
import { executeLocalCommand } from './commands.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const help = `Flow Batch Automator — WSL/Linux
Uso: flow-batch COMANDO
  setup --extension PASTA [--library PASTA] [--workspace PASTA]
        [--clients antigravity,codex] [--codex-config ARQUIVO]
        [--antigravity-config ARQUIVO]
        [--project NOME] [--volume NOME]
  up                  Compila as imagens locais, sincroniza a extensão e inicia
  down                Para o Compose preservando o volume
  status              Mostra o estado real dos serviços
  logs                Mostra as últimas 100 linhas do servidor
  doctor              Verifica pré-requisitos, arquivos e contrato da API
  mcp                 Inicia o conector stdio
  mcp install CLIENTE [opções do instalador]
  library init|import|export|validate|convert|restore [PASTA] [ARQUIVO|REVISAO]
  orders list|show|checkout|renew|publish|approve ...
FLOW_BATCH_HOME escolhe a pasta de configuração (padrão: ~/.flow-batch).
setup cria biblioteca/biblioteca.md vazio; --library escolhe outra pasta.
Não há instalação automática por postinstall. setup registra os dois clientes;
up mantém o serviço em Docker. Nenhum desses comandos autoriza gerações.`;
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === 'help') {
    console.log(help);
    return;
  }
  if (process.platform !== 'linux')
    throw new Error(
      'Esta versão do pacote suporta WSL/Linux. O suporte nativo ao Windows fica para uma próxima etapa.',
    );
  await executeLocalCommand(command, args, stateDirectory(), packageRoot);
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Falha ao executar a CLI.',
  );
  process.exitCode = 1;
});
