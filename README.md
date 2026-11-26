# Flow Batch Automator

Aplicação local para organizar e automatizar a produção de vídeos verticais.
Reúne materiais de referência, instruções criativas, preparação de falas e prompts,
geração de imagens e vídeos e download dos arquivos finais.

A operação é organizada em pedidos, formatos e variações. O painel reúne os
materiais; um agente conectado pelo MCP prepara o conteúdo; o servidor valida e
coordena a fila; o executor local (`flow-mcp` e app desktop Electron no Windows) executa as gerações no Google Flow.
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
4. **Execute a fila.** O executor escolhido prepara o projeto do lote no Flow e processa
   um take por vez, registrando as etapas de imagem, vídeo e download.
5. **Acompanhe e receba os arquivos.** Consulte pelo chat o andamento, as falhas e
   os MP4s confirmados. Os arquivos ficam nos downloads configurados do Chrome.

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

| Componente          | Responsabilidade                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Painel local        | Cadastro dos pedidos e dos materiais, com a lista de pedidos salvos.                                 |
| Conector MCP        | Preparação, acompanhamento e controle da fila pelo agente, com acesso às instruções e aos materiais. |
| Orquestrador        | Validação, compilação dos prompts, autorizações, fila e persistência.                                |
| App Desktop         | Aplicativo Electron nativo para Windows com painel, perfis Chrome, pareamento e instalação dos MCPs. |
| Executor Chrome     | Conexão CDP ao Chrome dedicado, envio na interface do Flow e confirmação dos downloads.              |
| Biblioteca local    | Regras de copy, imagem e animação e instruções dos formatos.                                         |
| Armazenamento local | Registros em SQLite e materiais importados em arquivos identificados por hash.                       |

A preparação criativa cabe ao agente. O orquestrador compila os textos com os
templates da biblioteca e mantém os registros de execução. O executor usa a
sessão do Flow em um perfil dedicado do Chrome; as credenciais permanecem no navegador.

## Instalação e execução

### App Desktop Windows (`packages/desktop`)

O modo principal no Windows executa nativamente orquestrador, SQLite, biblioteca,
executor Chrome e controles de login/perfil sem Docker ou terminal no dia a dia:

```sh
pnpm install --frozen-lockfile
pnpm desktop:dist:win
```

O pacote gerado fica em `packages/desktop/release/win-unpacked/Flow Batch.exe`
(e `packages/desktop/release/Flow Batch-0.1.0-win.zip`). Ao abrir o aplicativo:

1. Use **MCP Antigravity** ou **MCP Codex** na barra superior para registrar `flow-batch` e `flow-browser`.
2. Use **Login / Trocar conta** para autenticar no Google Flow sem automação e feche o Chrome ao concluir.
3. Clique em **Conectar Flow** e depois em **Parear executor**. Após confirmar o código em **Conexões**, o app conecta o worker automaticamente.
4. Use **Perfil Chrome** / **+ Novo perfil** sempre que quiser alternar ou isolar contas mantendo o pareamento local.
5. Opere a fila pelo chat. Nas próximas sessões, **Conectar Flow** também conecta o worker já autorizado. A barra oferece **Conectar executor** quando ele estiver desconectado.

Os containers de criação e de pedidos salvos têm a mesma altura, com rolagem
interna em cada um. **Limpar pedidos** remove da lista os pedidos elegíveis,
preservando materiais e histórico. Pedidos em preparação ou com trabalho
pendente continuam disponíveis.

### Docker Compose (opcional em Linux)

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm library seed /CAMINHO/Biblioteca-Flow
pnpm library validate /CAMINHO/Biblioteca-Flow
```

`library seed` inicia a edição de instruções do projeto em uma pasta nova ou em
um scaffold vazio sem capturas. Bibliotecas com conteúdo próprio são preservadas.

Crie `.env` a partir de `.env.example`, preservando um arquivo já existente:

```dotenv
FLOW_LIBRARY_DIR=/CAMINHO/Biblioteca-Flow
LOG_LEVEL=info
```

Os caminhos pertencem ao ambiente que executa o Compose. No WSL, use o caminho
Linux da pasta Windows.

```sh
docker compose config --quiet
docker compose up -d --build
```

O build instala as dependências fixadas pelo lockfile dentro da imagem.
O orquestrador usa o volume persistente `sqlite_data` e monta a biblioteca em `/library`.

Abra <http://127.0.0.1:4319/orders> para montar pedidos e <http://127.0.0.1:4319/connect> para autorizar o executor local.

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

### MCP de navegador e executor local

O pacote `packages/flow-mcp` contém um servidor MCP próprio para consultar e
executar no Flow pela interface, usando Playwright/CDP em um Chrome com perfil dedicado.
A implementação foi orientada pela arquitetura do
[GTAI-1/flow-mcp](https://github.com/GTAI-1/flow-mcp); não exige instalar esse
O agente continua criando copys e prompts pelo MCP `flow-batch`; o executor local
recebe da fila os takes já preparados e autorizados.

Após instalar as dependências e compilar o projeto:

```sh
pnpm flow:login
# Conclua o login manual e feche a janela antes do próximo comando.
pnpm flow:connect
pnpm flow:status
pnpm flow:mcp
```

Para usar um executável em outro local, configure-o uma vez:

```sh
pnpm flow:login --chrome /CAMINHO/Chrome/chrome
```

O caminho fica em `settings.json` na pasta de estado do MCP. Essa preferência é
local ao sistema operacional; `FLOW_BROWSER_CHROME` tem precedência quando
exportada. Use o Chrome comum para a conta real. O Chrome for Testing é reservado
aos testes sintéticos; sua disponibilidade não comprova que o Google aceitará
um login real nesse navegador.

`flow:login` abre uma janela comum para entrar no Google manualmente, sem CDP,
conexão Playwright ou scripts durante a entrada das credenciais. O perfil fica
em `~/.flow-batch/flow-browser/chrome-profile`. Enquanto essa janela estiver
aberta, `flow:status` informa `manual-login`, sem consultar a conta, e o controle
fica bloqueado. Conclua o login e feche essa janela; `flow:connect` reabre o mesmo
perfil e conecta a automação. O estado e os arquivos do perfil são preservados.

Se aparecer “This browser or app may not be secure”, o Google recusou esse
contexto de autenticação. A [orientação do Google](https://support.google.com/accounts/answer/7675428?co=GENIE.Platform%3DDesktop&hl=pt-BR)
inclui usar um navegador compatível e atualizado e informa que logins sob
automação podem ser bloqueados. A separação do login manual não garante a
aceitação da conta. Não são alteradas proteções do navegador nem exportados
cookies para tentar autenticar outro contexto.

A descoberta das ferramentas funciona com o Chrome fechado. Encerrar o cliente
MCP mantém a janela e a sessão do Chrome. As consultas posteriores usam apenas
o perfil dedicado aberto por `flow:connect`.

O processo MCP deve executar no mesmo sistema operacional do Chrome. Para
Chrome do Windows, use Node do Windows e caminhos Windows; para execução no WSL,
use um Chrome Linux com sessão gráfica. Não são configurados encaminhamento
de portas, acesso remoto ou alterações globais do navegador. A consulta real
via MCP foi validada em Linux/WSLg com Chrome comum: login manual preservado
após reabrir o perfil, abertura de projeto existente, listagem de mídias e
confirmação de uma imagem pelo ID. O percurso de geração e download do novo executor
é validado com respostas sintéticas em Chrome isolado. A geração real paga e a
execução nativa no Windows e macOS ainda precisam de validação própria.

Com o painel atualizado pelo Compose, conecte a identidade local à fila:

```sh
pnpm flow:pair
# Abra a confirmationUrl retornada, compare o código e confirme em /connect.
pnpm flow:executor-status
pnpm flow:worker
```

`flow:worker` fica em primeiro plano. Pelo MCP, `flow_browser_start_worker`
inicia o processo em segundo plano. Escolha o `clientId` retornado por
`flow_browser_executor_status` ao publicar ou aprovar um pedido pelo `flow-batch`.
A conexão exige confirmação explícita em `/connect`; iniciar o processo não
autoriza pedidos novos nem repetições. `pnpm flow:pause` pausa os próximos takes,
sem interromper a geração já enviada. Um novo despacho exige autorização no chat.

A identidade do executor usa assinatura P-256 e desafios de uso único, com
protocolo v9. Sua chave local fica em `executor-identity.json` na pasta de estado,
com permissão 0600 nos sistemas POSIX; ela não contém credenciais do Google.
As credenciais do Flow permanecem no perfil do Chrome. Operações que navegam ou
percorrem a grade reservam o navegador para não interferir em um take ativo.
Após interrupção com lock persistente, confira o processo e a fila antes de
qualquer remoção manual; não há retomada automática de gerações.

Os novos takes desse executor registram `driver: browser-ui` e `seed: null`,
pois a interface não oferece controle de seed. Contratos anteriores mantêm seus
valores. O executor confere modelo, proporção, duração, resolução e quantidade
antes de enviar, exige custo zero para imagem e limita o vídeo a 25 créditos
por take. Se uma opção ou cotação não puder ser confirmada, interrompe o envio.
Os prompts são preservados sem edição. Imagens reutilizadas são conferidas pelo ID;
não existe geração de substituição.

O download precisa dos eventos de início e conclusão do Chrome, com GUID, e de
um arquivo MP4 com tamanho correspondente. Os arquivos vão para `~/Downloads/Flow/Videos/...`
ou para `FLOW_BROWSER_DOWNLOADS_DIR/Flow/Videos/...`, sem sobrescrever arquivos.
As tentativas, checkpoints, autorizações, pausas e resultados incertos ficam
registrados no orquestrador e podem ser consultados pelo chat.

Configure o cliente MCP para executar `node /CAMINHO/flow-batch-automator/packages/flow-mcp/dist/main.js`,
com o nome de servidor `flow-browser`, ao lado do conector de pedidos `flow-batch`.
O comando não modifica configurações dos clientes automaticamente.

| Ferramenta                     | Comportamento                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `flow_browser_status`          | Informa sessão, projeto, idioma e geração em andamento.                                                            |
| `flow_browser_login`           | Abre ou reutiliza o Chrome dedicado para o usuário fazer login manualmente.                                        |
| `flow_browser_connect`         | Após o login e o fechamento da janela manual, reabre o mesmo perfil e conecta o controle.                          |
| `flow_browser_open_project`    | Abre um projeto existente por UUID na mesma aba; preserva textos no compositor e recusa navegação durante geração. |
| `flow_browser_assets`          | Percorre a grade da visualização atual e lista imagens/vídeos com IDs estáveis, dentro dos limites informados.     |
| `flow_browser_find_image`      | Confirma uma imagem por ID no projeto informado.                                                                   |
| `flow_browser_pair`            | Solicita a conexão local e retorna código e URL para confirmação em `/connect`.                                    |
| `flow_browser_executor_status` | Consulta autorização, conexão e `clientId` do executor.                                                            |
| `flow_browser_start_worker`    | Inicia o executor já autorizado para receber os pedidos destinados a ele.                                          |
| `flow_browser_pause_worker`    | Pausa o início dos próximos takes.                                                                                 |

As consultas respeitam a visualização e os filtros existentes. A listagem informa
se atingiu o fim da rolagem e se encontrou mídias sem ID estável; isso não prova
que todas as mídias do projeto foram consultadas. Títulos repetidos permanecem
separados pelos IDs. URLs assinadas não servem como identidade nem são retornadas.
Uma imagem não confirmada encerra a consulta, sem gerar uma substituta.

### Consultar, atualizar e parar

```sh
docker compose ps
docker compose logs --tail=100 orchestrator
docker compose up -d --build
docker compose down
```

Após atualizar, recarregue o cliente MCP e reconecte o executor quando necessário. `down` preserva o volume
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

### Controle da fila pelo chat

Use o painel para salvar o pedido e anotar seu número. Peça ao agente, por exemplo,
“Qual é o andamento do pedido 12?”, “Pause a fila” ou “Retome a fila”.
O executor continua em segundo plano enquanto o app e o Chrome dedicado estiverem abertos.

| Ferramenta do `flow-batch`                                            | Operação                                                                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `flow_queue_status`, `flow_order_diagnostics`                         | Consultam a pausa, os executores, os takes, dependências e MP4s confirmados.                         |
| `flow_wait_order`                                                     | Acompanha a execução até os downloads confirmados ou uma situação que exija atenção.                 |
| `flow_queue_control`                                                  | Pausa ou retoma trabalhos já autorizados.                                                            |
| `flow_cancel_take`, `flow_cancel_order`                               | Cancelam um take pendente ou um pedido ainda sem despacho.                                           |
| `flow_resolve_take`, `flow_retry_take`                                | Registram a revisão de um resultado ou autorizam outra tentativa com o conteúdo da última tentativa. |
| `flow_review_dispatch`, `flow_resume_dispatch`, `flow_close_dispatch` | Consultam, retomam ou encerram um grupo bloqueado conforme o diagnóstico.                            |
| `flow_set_auto_retry`, `flow_clear_orders`                            | Gerenciam a autorização de tentativa automática e removem pedidos elegíveis da lista.                |

A pausa fica gravada no orquestrador, inclusive após reconexão. Ela impede novos
takes e novas reservas de criação de projeto. Uma tentativa ativa pode terminar.
A fila executa um take por vez e espera 15 segundos após um download confirmado.

Ao pedir “Prepare o pedido 12” ou autorizar a execução de uma preparação, o
agente deve acompanhar por padrão no mesmo chat. Isso também vale para novas
tentativas, revisões executadas e retomadas autorizadas da fila. Enfileirar o
trabalho não encerra o acompanhamento: o agente consulta `flow_wait_order` pelo
UUID enquanto `in_progress`, inclusive quando uma janela de consulta terminar.
A resposta final lista os MP4s confirmados pelo Chrome ou informa a etapa da
pausa, falha, desconexão ou resultado incerto e a ação necessária. Preparações
sem execução não iniciam acompanhamento. Para sair após enfileirar, diga
“Só despache o pedido 12, sem aguardar”. O executor continua em segundo plano
se o chat fechar. A resposta de acompanhamento depende da sessão ativa.

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

Confira o projeto e os downloads antes de resolver um resultado incerto pelo chat.
`flow_resolve_take` registra falha confirmada ou ausência de envio. Um envio confirmado
pelo Flow exige revisão com resultado de falha e o histórico preserva os checkpoints.

Ao pedir a revisão de um take no chat, o usuário autoriza revisar a fala e o
prompt e gerar uma única nova tentativa de vídeo com a imagem existente. O agente consulta
`flow_review_take` e publica a revisão com `flow_prepare_take_revision`.
Para revisar sem executar, a versão fica preparada; a execução posterior usa
`flow_approve_take_revision`. Os parâmetros, a imagem, os materiais e a entrada
original permanecem vinculados ao histórico. Quando a imagem ainda não foi
confirmada, o diagnóstico mostra por que essa revisão está indisponível.

Repetir o conteúdo da última tentativa exige conferir a falha no Flow e
autorizar no chat o orçamento informado no diagnóstico.
As proteções contra repetição abrangem imagens e vídeos: uma imagem já confirmada
é reutilizada pelo ID, com zero novas imagens; se não for encontrada, o executor
para sem gerar uma substituta. Um vídeo já localizado impede outra geração mesmo
quando o download falhou. Envio sem resultado confirmado exige revisão antes de
repetir. Essas verificações dependem das evidências registradas e da conferência
no Flow; não garantem execução exatamente uma vez. O agente acompanha também a
nova tentativa até os downloads confirmados ou uma interrupção que exija ação.
`flow_set_auto_retry` concede até uma tentativa extra por take em 24 horas, somente
para falhas comprovadas antes do envio. Resultados incertos exigem revisão e
recusas de conteúdo exigem revisar o take.

`flow_unusual_activity` indica que o Google Flow bloqueou a atividade.
Quando o executor identifica bloqueio antes do envio, interrompe a etapa
e não solicita repetição automática. Uma recusa recebida após o
envio mantém o resultado incerto para revisão, preservando as etapas registradas.
Aguarde alguns minutos e confira a sessão e a conta na janela do Chrome; a
[ajuda do Google](https://support.google.com/flow/answer/16353333?hl=pt-BR)
também recomenda desativar VPN ou proxy, se estiverem em uso. Outra tentativa
exige nova autorização no chat ou resolução explícita no diagnóstico. Isso não garante a liberação pelo Google.

Grupos bloqueados podem ser encerrados pelo chat quando suas condições permitirem.
`flow_clear_orders` retira pedidos elegíveis da lista, preservando os materiais,
resultados e histórico. Ao esvaziar a lista de pedidos, um novo
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

| Variável                     | Uso                                                                  |
| ---------------------------- | -------------------------------------------------------------------- |
| `FLOW_LIBRARY_DIR`           | Pasta da biblioteca ativa; obrigatória no Compose.                   |
| `FLOW_DESKTOP_HOME`          | Raiz local do app desktop; padrão `~/.flow-batch`.                   |
| `FLOW_API_URL`               | Endereço usado pelo MCP e pela CLI; padrão `http://127.0.0.1:4319`.  |
| `FLOW_AGENT_WORKSPACE`       | Pasta de trabalho do MCP; padrão `~/.flow-batch/pedidos`.            |
| `FLOW_AGENT_NAME`            | Identificação usada pela CLI de pedidos; padrão `agente-local`.      |
| `CODEX_HOME`                 | Pasta de configuração do Codex; padrão `~/.codex`.                   |
| `LOG_LEVEL`                  | Nível dos logs; padrão `info`.                                       |
| `FLOW_BROWSER_HOME`          | Estado do MCP de navegador; padrão `~/.flow-batch/flow-browser`.     |
| `FLOW_BROWSER_CHROME`        | Executável absoluto do Chrome dedicado; por padrão, detecção local.  |
| `FLOW_BROWSER_DOWNLOADS_DIR` | Raiz de downloads do executor local; padrão `~/Downloads`.           |
| `HOST` / `PORT`              | Endereço interno do servidor; o Compose define `0.0.0.0` e `4319`.   |
| `DATABASE_PATH`              | Caminho do SQLite; o Compose define `/data/flow-batch.sqlite`.       |
| `MATERIALS_DIR`              | Pasta de materiais; por padrão `materials` junto ao SQLite.          |
| `LIBRARY_DIR`                | Pasta de instruções lida pelo servidor; o Compose define `/library`. |
| `SQLITE_BUSY_TIMEOUT_MS`     | Espera de bloqueio do SQLite; padrão 3000 ms.                        |

O Compose lê `.env`. Os comandos locais usam argumentos ou variáveis exportadas.
Na CLI da biblioteca, a pasta explícita tem precedência; depois são consultadas
`FLOW_LIBRARY_DIR`, `LIBRARY_DIR` e `~/.flow-batch/biblioteca`.

## Desenvolvimento e validação

| Pasta                   | Conteúdo                                                  |
| ----------------------- | --------------------------------------------------------- |
| `packages/protocol`     | Contratos Zod, tipos e compilação das preparações.        |
| `packages/orchestrator` | API Fastify, SQLite, fila, biblioteca e MCP.              |
| `packages/desktop`      | App Electron para Windows com orquestrador e controles.   |
| `packages/flow-mcp`     | MCP do Flow e executor da fila via Chrome dedicado e CDP. |
| `shared/styles`         | Tema compartilhado pelo painel e pelo app desktop.        |
| `instrucoes`            | Edição de regras criativas e templates.                   |
| `skills`                | Orientações operacionais para o agente.                   |
| `scripts`               | Ferramentas de manutenção, desenvolvimento e validação.   |

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
pnpm check
pnpm desktop:dev
pnpm desktop:dev:win
pnpm desktop:dist:win
pnpm test:docker
pnpm test:browser:library
pnpm test:browser:cloning
pnpm test:browser:orders-design
pnpm test:browser:connect
pnpm test:browser:session
pnpm test:browser:flow-mcp
```

`pnpm dev` inicia o servidor no host para desenvolvimento. Os testes usam dados
sintéticos e perfis isolados de navegador. `test:docker` usa projeto, imagens,
porta e volume próprios e verifica a persistência após reiniciar os contêineres.
As validações com fixtures comprovam os cenários simulados; gerações reais
exigem autorização específica e validação própria.

`test:browser:flow-mcp` também percorre um pedido sintético pelo painel, checkout,
preparação, despacho autorizado, criação de projeto, imagem compartilhada e três
downloads confirmados pelo Chrome. Confere intervalo de 15 segundos e revogação
sem reenvio. Usa API isolada na porta 4398 e diretórios temporários; exige build
atualizado do workspace.

As regras de contribuição e segurança estão em [`AGENTS.md`](AGENTS.md).
As atribuições de código estão em [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
