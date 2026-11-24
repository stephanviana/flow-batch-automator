# Flow Batch Automator

Aplicação local para organizar e automatizar a produção de vídeos verticais.
Reúne materiais de referência, instruções criativas, preparação de falas e prompts,
geração de imagens e vídeos e download dos arquivos finais.

A operação é organizada em pedidos, formatos e variações. O painel reúne os
materiais; um agente conectado pelo MCP prepara o conteúdo; o servidor valida e
coordena a fila; a extensão do Chrome executa as gerações no Google Flow.
As instruções locais definem a linguagem, o objetivo e a direção visual de cada
produção.

## Como funciona

1. **Monte o pedido.** Cadastre as informações e os materiais, escolha os
   formatos e indique a quantidade de variações.
2. **Prepare o conteúdo.** Peça ao agente para preparar um ou vários números de
   pedido. O MCP entrega os materiais verificados e as instruções correspondentes.
3. **Valide a preparação.** O servidor confere os campos, as quantidades, os
   vínculos de imagem e a autorização de execução. Cada preparação conserva as
   instruções e os materiais usados.
4. **Execute a fila.** A extensão prepara o projeto do lote no Flow e processa
   um take por vez, registrando as etapas de imagem, vídeo e download.
5. **Acompanhe e receba os arquivos.** O painel e a extensão mostram o andamento,
   as falhas e o histórico. Os MP4s concluídos ficam nos downloads do Chrome.

### Organização da produção

| Termo    | Significado no projeto                                                                    |
| -------- | ----------------------------------------------------------------------------------------- |
| Pedido   | Conjunto de informações, materiais, formatos e quantidades a produzir.                    |
| Produto  | Unidade de cadastro usada pelo painel para agrupar informações e materiais de referência. |
| Formato  | Conjunto de instruções de composição, fala e animação.                                    |
| Variação | Uma versão do vídeo, composta por gancho, desenvolvimento (Body) e encerramento (CTA).    |
| Take     | Um dos três vídeos gerados para uma variação.                                             |
| Lote     | Grupo de takes vinculado a um projeto do Flow.                                            |

A configuração padrão usa proporção 9:16, takes de 8 segundos em 720p,
Nano Banana Pro para imagens e Omni 1.1 Flash para vídeos. O pedido também
permite selecionar Veo 3.1 Lite para todos os seus takes.

### Componentes

| Componente          | Responsabilidade                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Painel local        | Cadastro dos pedidos, materiais, prévias, acompanhamento e diagnóstico.                    |
| Conector MCP        | Consulta e preparação dos pedidos por um agente, com acesso às instruções e aos materiais. |
| Orquestrador        | Validação, compilação dos prompts, autorizações, fila e persistência.                      |
| Extensão Chrome     | Conexão com o servidor, execução na aba do Flow e confirmação dos downloads.               |
| Biblioteca local    | Regras de copy, imagem e animação e instruções dos formatos.                               |
| Armazenamento local | Registros em SQLite e materiais importados em arquivos identificados por hash.             |

A preparação criativa cabe ao agente. O orquestrador compila os textos com os
templates da biblioteca e mantém os registros de execução. A extensão usa a
sessão do Flow no navegador; as credenciais permanecem no Chrome.

## Instalação e execução

A aplicação executa pelo Docker Compose do repositório.
São necessários Docker com Compose, Chrome 120+ e Node.js 24.22.2 LTS ou
26.12.1 para o MCP e os comandos locais. O projeto usa pnpm 12.15.0.
No Windows, execute os comandos pelo Linux/WSL com acesso ao Docker e carregue
a extensão no Chrome do Windows.

### Primeira configuração

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm library seed /CAMINHO/Biblioteca-Flow
pnpm library validate /CAMINHO/Biblioteca-Flow
mkdir -p /CAMINHO/flow-batch-extension
```

`library seed` inicia a edição de instruções do projeto em uma pasta nova ou em
um scaffold vazio sem capturas. Bibliotecas com conteúdo próprio são preservadas.

Crie `.env` a partir de `.env.example`, preservando um arquivo já existente.
Configure duas pastas absolutas e existentes:

```dotenv
WIN_EXTENSION_DIR=/CAMINHO/flow-batch-extension
FLOW_LIBRARY_DIR=/CAMINHO/Biblioteca-Flow
LOG_LEVEL=info
```

Os caminhos pertencem ao ambiente que executa o Compose. No WSL, use o caminho
Linux da pasta Windows. O destino da extensão deve estar vazio ou identificado
como uma instalação do Flow Batch Automator.

```sh
docker compose config --quiet
docker compose up -d --build
```

O build instala as dependências fixadas pelo lockfile dentro da imagem.
O serviço `sync-extension` copia os arquivos gerenciados da extensão para a pasta
configurada. O orquestrador usa o volume persistente `sqlite_data` e monta a
biblioteca em `/library`.

No Chrome:

1. Abra `chrome://extensions` e ative o modo do desenvolvedor.
2. Carregue sem compactação a pasta configurada em `WIN_EXTENSION_DIR`.
3. Confirme a conexão em <http://127.0.0.1:4319/connect>.
4. Abra <http://127.0.0.1:4319/orders> para montar pedidos.
5. Entre na conta do Google Flow usada para as gerações.

### Conectar o agente pelo MCP

Execute o comando correspondente ao cliente utilizado:

```sh
pnpm mcp:install codex
pnpm mcp:install antigravity
```

O instalador registra `flow-batch` no cliente escolhido e guarda o conector em
`~/.flow-batch/mcp/`. Ele preserva os valores das configurações e cria backups
antes de substituir arquivos; autorize esses backups antes de executá-lo.
Reabra o cliente para carregar a conexão.

Para escolher o workspace de produção e o endereço do servidor:

```sh
pnpm mcp:install codex --workspace /CAMINHO/Pedidos-Flow --server http://127.0.0.1:4319
```

`--config ARQUIVO` seleciona a configuração do cliente; `--directory PASTA`
seleciona onde guardar o conector. O workspace padrão é `~/.flow-batch/pedidos`.
Use uma pasta de produção separada do código da aplicação.

O conector também pode ser baixado do servidor:

```sh
curl --fail http://127.0.0.1:4319/agent/flow-batch-mcp.mjs -o /CAMINHO/flow-batch-mcp.mjs
node /CAMINHO/flow-batch-mcp.mjs --install codex
```

### Consultar, atualizar e parar

```sh
docker compose ps
docker compose logs --tail=100 orchestrator
docker compose up -d --build
docker compose down
```

Após atualizar, recarregue a extensão e o cliente MCP. `down` preserva o volume
de dados. A publicação HTTP fica restrita a `127.0.0.1:4319`; o contêiner executa
sem privilégios e com raiz somente para leitura.

## Uso dos pedidos

O painel organiza cada pedido por produtos, com informações, imagens de
referência, materiais adicionais, formatos e quantidades. É possível acumular
várias imagens e remover cada uma individualmente. A imagem marcada como
**Principal no Flow** é usada na geração; todas as referências ficam disponíveis
para a preparação criativa.

Cada produto admite até 30 materiais. Imagens e documentos podem ter até 8 MB;
o MP4 de referência para clonagem pode ter até 64 MB.

Depois de salvar, envie ao agente uma solicitação com os números desejados:

- **“Prepare o pedido 12.”** Autoriza a preparação e a execução dos formatos e
  quantidades desse pedido, incluindo o consumo de créditos correspondente.
- **“Apenas prepare os pedidos 12 e 15 para revisão.”** Salva a preparação para
  consultar a prévia antes da execução.
- **“Execute o pedido 12.”** Autoriza executar uma preparação já existente.

O agente usa `flow_list_orders`, `flow_show_order`, `flow_checkout`,
`flow_publish` e `flow_approve`. A reserva de preparação dura 30 minutos e pode
ser renovada com `flow_renew`. O checkout entrega os arquivos verificados,
as instruções capturadas e os campos que precisam ser preenchidos.
Quando há várias extensões autorizadas, escolha a que executará o pedido.

### Formatos e imagens

| Formatos disponíveis                                                          | Imagens por variação                                                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Fábrica Padrão, Fábrica Grupo, Fábrica + Caminhão e Fábrica Esteira Inclinada | Uma para o gancho e outra para o Body; o CTA reutiliza a imagem do Body.                 |
| POV + Vendedora                                                               | Gancho com mãos e voz fora de câmera; Body e CTA compartilham a imagem da apresentadora. |
| Full POV                                                                      | Uma imagem compartilhada pelos três takes, com mãos e voz fora de câmera.                |
| Full Vendedora                                                                | Uma imagem compartilhada pelos três takes.                                               |
| Clonagem                                                                      | Uma a três imagens, conforme o plano de cenas da referência.                             |

Na clonagem, o agente analisa o MP4 e associa os takes às cenas observadas.
Cenas repetidas reutilizam a imagem do primeiro take que a gerou; cenas distintas
recebem imagens próprias. A foto principal mantém a identidade visual do produto.

O modo **Adaptar formato** cria novas falas a partir da estrutura da referência.
**Preservar copy** mantém a transcrição conferida em cada take e entre as
variações, adaptando a direção visual. O agente analisa o áudio e o servidor
valida a correspondência dos textos.

### Acompanhamento e resultados

A extensão reúne as abas **Início**, **Fila e gerações** e **Configurações**.
O painel e a extensão mostram as etapas registradas, pausas, falhas e resultados
que precisam de revisão. Cada lote conserva o vínculo com seu projeto do Flow.
A fila executa um take por vez e espera 15 segundos após um download confirmado
antes de iniciar o próximo take.

Os vídeos de cada variação ficam juntos nos downloads do Chrome:

```text
Flow/Videos/<produto>--<formato>--<identificador>/
  01-Gancho.mp4
  02-Body.mp4
  03-CTA.mp4
```

A conclusão exige confirmação do download pelo Chrome. O histórico registra
as tentativas, as autorizações e as etapas de geração.

### Falhas e revisão

**Ver diagnóstico** mostra a situação do pedido, seus grupos e takes.
**Verificar resultado no Flow** consulta a operação registrada e a imagem de
origem. Use essa consulta para conferir um resultado incerto antes de decidir
sobre outra tentativa.

**Solicitar revisão no chat** copia uma solicitação identificando o take.
Ao enviá-la ao agente, o usuário autoriza revisar a fala e o prompt e gerar uma
única nova tentativa de vídeo com a imagem existente. O agente consulta
`flow_review_take` e publica a revisão com `flow_prepare_take_revision`.
Para revisar sem executar, a versão fica preparada; a execução posterior usa
`flow_approve_take_revision`. Os parâmetros, a imagem, os materiais e a entrada
original permanecem vinculados ao histórico.

**Autorizar tentativa automática** concede até uma tentativa extra por take
por 24 horas, somente para falhas comprovadas antes do envio. O painel mostra
o orçamento adicional e permite revogar a autorização. Resultados incertos
exigem revisão; recusas de conteúdo exigem revisar o take.

Grupos bloqueados podem ser encerrados quando suas condições permitirem.
A limpeza do painel e da fila retira registros elegíveis da visualização,
preservando os resultados e o histórico. Ao esvaziar a lista de pedidos, um novo
ciclo de numeração começa em #1.

## Biblioteca de instruções

A edição versionada fica em [`instrucoes/`](instrucoes). `base.md` reúne as seções
`[common]`, `[copy]`, `[image]` e `[animation]`; `formatos/` contém as orientações
dos oito formatos. Copy, identidade visual, composição, apoio físico e movimento
são definidos nessa biblioteca.

A biblioteca ativa é a pasta escolhida em `FLOW_LIBRARY_DIR`. Cada reserva
captura os arquivos usados na preparação. Edições posteriores valem para novas
reservas; preparações existentes conservam suas capturas. Atualizar a aplicação
preserva as instruções locais.

```sh
pnpm library seed /CAMINHO/Biblioteca-Flow
pnpm library init /CAMINHO/Biblioteca-Vazia
pnpm library validate /CAMINHO/Biblioteca-Flow
pnpm library split /CAMINHO/Biblioteca-Flow
```

`seed` inicia a edição do projeto; `init` cria somente o scaffold vazio;
`validate` confere os arquivos; `split` apresenta uma prévia da divisão de uma
biblioteca em documento único. Importação, exportação, conversão e restauração
continuam disponíveis:

```sh
pnpm library export /CAMINHO/Biblioteca-Flow /CAMINHO/biblioteca.md
pnpm library import /CAMINHO/Biblioteca-Flow /CAMINHO/biblioteca.md
pnpm library convert /CAMINHO/Biblioteca-Flow
pnpm library restore /CAMINHO/Biblioteca-Flow REVISAO
```

A exportação em JSON inclui as capturas históricas. Operações que arquivam
conteúdo substituído e `split --preserve-originals` exigem autorização explícita
para o backup. `instrucoes.json`, `.historico/` e `.rascunhos/` pertencem à
biblioteca ativa e devem ser preservados junto de seus textos.

## Configuração

| Variável                 | Uso                                                                     |
| ------------------------ | ----------------------------------------------------------------------- |
| `WIN_EXTENSION_DIR`      | Pasta existente para sincronização da extensão; obrigatória no Compose. |
| `FLOW_LIBRARY_DIR`       | Pasta da biblioteca ativa; obrigatória no Compose.                      |
| `FLOW_API_URL`           | Endereço usado pelo MCP e pela CLI; padrão `http://127.0.0.1:4319`.     |
| `FLOW_AGENT_WORKSPACE`   | Pasta de trabalho do MCP; padrão `~/.flow-batch/pedidos`.               |
| `FLOW_AGENT_NAME`        | Identificação usada pela CLI de pedidos; padrão `agente-local`.         |
| `CODEX_HOME`             | Pasta de configuração do Codex; padrão `~/.codex`.                      |
| `LOG_LEVEL`              | Nível dos logs; padrão `info`.                                          |
| `HOST` / `PORT`          | Endereço interno do servidor; o Compose define `0.0.0.0` e `4319`.      |
| `DATABASE_PATH`          | Caminho do SQLite; o Compose define `/data/flow-batch.sqlite`.          |
| `MATERIALS_DIR`          | Pasta de materiais; por padrão `materials` junto ao SQLite.             |
| `LIBRARY_DIR`            | Pasta de instruções lida pelo servidor; o Compose define `/library`.    |
| `SQLITE_BUSY_TIMEOUT_MS` | Espera de bloqueio do SQLite; padrão 3000 ms.                           |

O Compose lê `.env`. Os comandos locais usam argumentos ou variáveis exportadas.
Na CLI da biblioteca, a pasta explícita tem precedência; depois são consultadas
`FLOW_LIBRARY_DIR`, `LIBRARY_DIR` e `~/.flow-batch/biblioteca`.

## Desenvolvimento e validação

| Pasta                   | Conteúdo                                                |
| ----------------------- | ------------------------------------------------------- |
| `packages/protocol`     | Contratos Zod, tipos e compilação das preparações.      |
| `packages/orchestrator` | API Fastify, SQLite, fila, biblioteca e MCP.            |
| `packages/extension`    | Extensão Chrome Manifest V3 e integração com o Flow.    |
| `shared/styles`         | Tema compartilhado pelo painel e pela extensão.         |
| `instrucoes`            | Edição de regras criativas e templates.                 |
| `skills`                | Orientações operacionais para o agente.                 |
| `scripts`               | Ferramentas de manutenção, desenvolvimento e validação. |

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
pnpm check
pnpm test:docker
pnpm test:browser:library
pnpm test:browser:orders --port=4389
pnpm test:browser:orders --format=clone --clone-scenes=abc --port=4389
pnpm test:browser:orders --format=clone --clone-scenes=aba --port=4389
pnpm test:browser:orders-design
pnpm test:browser:queue-design
pnpm test:browser:connect
pnpm test:browser:session
```

`pnpm dev` inicia o servidor no host para desenvolvimento. Os testes usam dados
sintéticos e perfis isolados de navegador. `test:docker` usa projeto, imagens,
porta e volume próprios e verifica a persistência após reiniciar os contêineres.
As validações com fixtures comprovam os cenários simulados; gerações reais
exigem autorização específica e validação própria.

As regras de contribuição e segurança estão em [`AGENTS.md`](AGENTS.md).
As atribuições de código estão em [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
