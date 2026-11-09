# Flow Batch Automator

Ferramenta local para preparar pedidos de TikTok Shop e executar gerações
autorizadas no Google Flow. O painel organiza produtos e materiais, o agente
conectado por MCP prepara copy e prompts e a extensão Chrome executa a fila.

## Instalação no Windows

Requisitos: Node.js 24.22.2 LTS (ou 26.12.1), npm e Chrome. No Windows, a
aplicação usa Node e SQLite diretamente, sem Docker ou WSL. Antigravity e Codex
devem executar no mesmo ambiente do conector.

No PowerShell:

```powershell
npm.cmd install --global __PACKAGE_NAME__
flow-batch.cmd setup --extension "$env:USERPROFILE\flow-batch-extension"
flow-batch.cmd library import "C:\CAMINHO\biblioteca.md"
flow-batch.cmd up
flow-batch.cmd doctor
```

Os comandos `.cmd` dispensam alterações na política de execução do PowerShell.
`up` inicia Node em segundo plano e sincroniza a extensão. `down` solicita o
encerramento limpo pelo controle local autenticado; não mata processos por PID.
Não há serviço Windows nem início automático após reiniciar o computador.
O banco e os materiais ficam em `%USERPROFILE%\.flow-batch\data` e a biblioteca
em `%USERPROFILE%\.flow-batch\biblioteca`. `--data PASTA` e
`FLOW_BATCH_HOME` permitem outros destinos, fora do prefixo npm.

## Instalação no Linux/WSL

Docker Compose é o padrão preservado nesse ambiente. Para usar somente Node,
acrescente `--runtime native` ao `setup`. A escolha fica salva; uma atualização
não muda o runtime existente. Windows usa o modo nativo por padrão.

```sh
npm install --global __PACKAGE_NAME__
flow-batch setup --extension /mnt/c/Users/SEU_USUARIO/flow-batch-extension
flow-batch library import /CAMINHO/biblioteca.md
flow-batch up
flow-batch doctor
```

`setup` registra Antigravity e Codex com caminhos absolutos do ambiente local,
preserva os demais servidores e cria backups antes de alterar configurações.
Use `--clients codex` ou `--clients antigravity` para registrar somente um.
`--codex-config ARQUIVO` e `--antigravity-config ARQUIVO` escolhem os destinos.
O Codex respeita `CODEX_HOME` na primeira configuração. Reabra os clientes MCP.
A instalação npm não tem scripts automáticos de configuração.

Novas bibliotecas usam `base.md` com `[common]`, `[copy]`, `[image]` e
`[animation]` e um arquivo em `formatos/` por formato. Setup cria a estrutura
vazia; importe suas instruções com `library import`. Layouts antigos e capturas
continuam legíveis. `instrucoes.json` preserva identidade e revisão, e
`.historico/` contém capturas necessárias. O nome `biblioteca.json` é migrado
sem alterar bytes; conflitos impedem abertura.

`library split` mostra a divisão sem alterações; `--preserve-originals`
aplica e arquiva originais, exigindo autorização para esse backup. `library
validate` verifica a biblioteca. CLI e MCP usam `flow-orders/5`; atualize o
conector junto do servidor.

No modo Docker, `up` constrói as imagens localmente, sincroniza a extensão e espera o servidor.
O npm instala as bibliotecas declaradas em `dependencies`, com versões diretas
exatas. O primeiro build Docker usa `runtime/package-lock.json` com `npm ci` para
instalar toda a árvore de produção fixada dentro da imagem Linux, além de baixar
a imagem Node fixada por digest.
O pacote distribui arquivos compilados, sem `node_modules` ou `app.tar.gz`. A API publica
somente em `127.0.0.1:4319`. Carregue a extensão não empacotada na pasta escolhida
no Chrome e confirme a conexão em <http://127.0.0.1:4319/connect>.
O painel fica em <http://127.0.0.1:4319/orders>.

## Atualização e operação

```sh
flow-batch down
npm install --global __PACKAGE_NAME__@latest
flow-batch setup
flow-batch up
flow-batch status
flow-batch logs
flow-batch orders list
flow-batch down
```

No Windows, os mesmos comandos estão disponíveis com `.cmd`. Encerre o modo
nativo antes de atualizar o pacote ou mudar runtime, porta ou pastas. `setup`
lembra as pastas, runtime e clientes selecionados. `down` preserva os dados;
no Docker, também preserva o volume.
Os arquivos locais ficam fora do prefixo npm, em `~/.flow-batch` por padrão.
`FLOW_BATCH_HOME` escolhe outra pasta. O projeto padrão é `flow-batch-local`,
com volume `flow-batch-local_sqlite_data`.

Para adotar uma instalação existente, confira seu projeto e volume reais,
pare o Compose anterior sem remover volumes e informe `--project NOME --volume NOME`
no `setup`, junto às pastas da biblioteca e extensão existentes. A aplicação
não escolhe, migra ou apaga instalações anteriores automaticamente.
Mudar de Docker para nativo não extrai seu volume. Pare e preserve a instalação
anterior antes de configurar a nova. Não transporte `installation.json` entre
Windows e WSL; seus caminhos pertencem ao ambiente em que foi criado.

No diretório de trabalho, peça ao agente “Prepare o pedido 12”: ele prepara e
despacha na mesma operação, sem hash nem segunda confirmação. Esse pedido no
chat inclui o consumo de créditos dos formatos e quantidades selecionados.
Para revisar antes, diga “Apenas prepare o pedido 12, não execute”. Instalar,
atualizar, importar instruções e publicar sem execução não autorizam geração.
A aplicação usa a sessão do Flow no navegador;
cookies e tokens Google não são exportados para o servidor.
