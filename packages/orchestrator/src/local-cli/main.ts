import { fileURLToPath } from 'node:url';
import { stateDirectory } from './config.js';
import { executeLocalCommand } from './commands.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const help = `Flow Batch Automator — Windows e WSL/Linux
Uso: flow-batch COMANDO
  setup --extension PASTA [--library PASTA] [--workspace PASTA]
        [--clients antigravity,codex] [--codex-config ARQUIVO]
        [--antigravity-config ARQUIVO]
        [--project NOME] [--volume NOME]
        [--runtime native|docker] [--data PASTA]
  up                  Sincroniza a extensão e inicia o servidor
  down                Encerra o servidor preservando os dados
  status              Mostra o estado real dos serviços
  logs                Mostra as últimas 100 linhas do servidor
  doctor              Verifica pré-requisitos, arquivos e contrato da API
  mcp                 Inicia o conector stdio
  mcp install CLIENTE [opções do instalador]
  library init|import|export|validate|convert|split|restore [PASTA] [ARQUIVO|REVISAO]
  orders list|show|checkout|renew|publish|approve ...
FLOW_BATCH_HOME escolhe a pasta de configuração (padrão: ~/.flow-batch).
setup instala instruções em bibliotecas novas ou scaffolds vazios; preserva edições locais.
--library escolhe a pasta ativa. library split mostra a divisão sem alterar arquivos.
Não há instalação automática por postinstall. setup registra os dois clientes;
Windows usa Node nativo sem Docker; Linux/WSL usa Docker por padrão.
--runtime native permite execução sem Docker no Linux/WSL também.
Nenhum desses comandos autoriza gerações.`;
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === 'help') {
    console.log(help);
    return;
  }
  if (!['linux', 'win32'].includes(process.platform))
    throw new Error('Esta versão suporta Windows e Linux/WSL.');
  await executeLocalCommand(command, args, stateDirectory(), packageRoot);
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Falha ao executar a CLI.',
  );
  process.exitCode = 1;
});
