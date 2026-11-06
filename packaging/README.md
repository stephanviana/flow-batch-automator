# Flow Batch Automator

Ferramenta local para preparar pedidos de TikTok Shop e executar gerações
autorizadas no Google Flow. O painel organiza produtos e materiais, o agente
conectado por MCP prepara copy e prompts e a extensão Chrome executa a fila.

## Instalação no WSL

Requisitos: WSL/Linux, Node.js 24.22.2 LTS (ou 26.12.1), npm e Docker com Compose.
Antigravity e Codex devem executar no mesmo ambiente WSL que o conector.
O suporte nativo ao Windows fica para uma próxima etapa.

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

A biblioteca usa um único `~/.flow-batch/biblioteca/biblioteca.md`, criado com
seções vazias por `setup`, sem regras criativas prontas. `--library PASTA` é
opcional e permite outro destino. Peça ao agente para preencher o documento ou
importe suas instruções. Seções comuns: `[common]`, `[copy]`, `[image]`; formatos:
`[factory]`, `[factory-group]`, `[factory-truck]`, `[factory-inclined]`, `[pov]`,
`[full-pov]`, `[seller]`, `[clone]`; templates: `[animation]`.
Cada seção começa com `# [identificador] Título`. Preserve o marcador inicial
`<!-- flow-biblioteca:1 -->` e os contratos dos templates de animação.

`flow-batch library validate` confere o arquivo. Para outra máquina, copie o
Markdown ou use `library export /CAMINHO/biblioteca.md` e importe após `setup`.
`library convert` reúne bibliotecas antigas de vários arquivos, preservando os
originais em `.rascunhos/`. A biblioteca existente não é convertida automaticamente.
Backups JSON com histórico continuam disponíveis com `library export DESTINO.JSON`.
Configuração,
SQLite, materiais e arquivos de trabalho não são distribuídos pelo npm.

`up` constrói as imagens localmente, sincroniza a extensão e espera o servidor.
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
npm install --global __PACKAGE_NAME__@latest
flow-batch setup
flow-batch up
flow-batch status
flow-batch logs
flow-batch orders list
flow-batch down
```

`setup` lembra as pastas e clientes selecionados. `down` preserva o volume.
Os arquivos locais ficam fora do prefixo npm, em `~/.flow-batch` por padrão.
`FLOW_BATCH_HOME` escolhe outra pasta. O projeto padrão é `flow-batch-local`,
com volume `flow-batch-local_sqlite_data`.

Para adotar uma instalação existente, confira seu projeto e volume reais,
pare o Compose anterior sem remover volumes e informe `--project NOME --volume NOME`
no `setup`, junto às pastas da biblioteca e extensão existentes. A aplicação
não escolhe, migra ou apaga instalações anteriores automaticamente.

No diretório de trabalho, peça ao agente “Prepare o pedido 12”: ele prepara e
despacha na mesma operação, sem hash nem segunda confirmação. Esse pedido no
chat inclui o consumo de créditos dos formatos e quantidades selecionados.
Para revisar antes, diga “Apenas prepare o pedido 12, não execute”. Instalar,
atualizar, importar instruções e publicar sem execução não autorizam geração.
A aplicação usa a sessão do Flow no navegador;
cookies e tokens Google não são exportados para o servidor.
