# Flow Batch Automator

Estas regras valem para todo o repositório. Instruções mais específicas de uma
camada continuam válidas dentro dela, respeitando as instruções do usuário.

## O que é este projeto

Aplicação local para organizar e automatizar operações de vídeos verticais.
O usuário monta pedidos no painel, o agente conectado pelo MCP prepara falas e
prompts, a API coordena a fila e o executor local (`flow-mcp`) executa no Google Flow. O objetivo,
a linguagem e a direção criativa são definidos pelo pedido e pelas instruções
locais. A saída são arquivos MP4 com histórico de preparação e execução.

O painel em `/orders` organiza materiais, formatos e quantidades em cadastros de
produtos. Cada variação usa os três takes e os contratos implementados.
O usuário pede ao agente que prepare um ou vários números de pedido.
Prefira o MCP local: `flow_list_orders`, `flow_checkout`, `flow_publish`
e `flow_approve`. O pedido direto “prepare o pedido N” inclui preparar e executar
os números selecionados no chat, nos formatos e quantidades do pedido, sem outra
confirmação nem hash de aprovação. Use `flow_publish` com `execute=true` e
`userAuthorized=true`; “apenas prepare”, “para revisão” ou “não execute” exige
`execute=false`. Para executar uma preparação existente, `flow_approve` usa só
número, autorização e cliente executor opcional. Isso não autoriza gerações nesta tarefa
de manutenção nem retomadas automáticas após falha.
O acompanhamento pelo agente é obrigatório por padrão após execução inicial,
nova tentativa, revisão executada ou retomada de trabalho autorizado pelo chat.
Use `flow_wait_order` após `flow_publish` com execução, `flow_approve`,
`flow_retry_take`, `flow_prepare_take_revision` com execução,
`flow_approve_take_revision`, `flow_resume_dispatch` e retomada por
`flow_queue_control`. Não encerre a resposta apenas porque o trabalho entrou na
fila. Continue por UUID enquanto `in_progress`, inclusive quando a janela de uma
consulta terminar, até todos os MP4s serem confirmados pelo Chrome ou até haver
pausa, falha, bloqueio, desconexão ou resultado incerto. Acompanhe todos os pedidos
selecionados ainda em andamento. Nessas interrupções, consulte os diagnósticos e
informe a etapa, os arquivos confirmados e a ação necessária. Só dispense a espera
se o usuário pedir explicitamente apenas o despacho ou não acompanhar. Preparação
sem execução não inicia acompanhamento. A consulta é somente leitura, não autoriza
repetições e depende da sessão ativa no chat. Se o cliente interromper a sessão ou
limitar a espera, informe o último estado confirmado e a interrupção; não prometa
acompanhamento ou notificações futuras.
A biblioteca criativa versionada está em `instrucoes/`: base.md e oito arquivos
`formatos/*.md`. `pnpm library seed [PASTA]` inicia a edição do checkout
na pasta escolhida apenas quando nova ou com scaffold modular vazio sem capturas.
Conteúdo local existente, incompleto ou legado é preservado. O runtime usa
somente LIBRARY_DIR (Compose: FLOW_LIBRARY_DIR).
Atualizar o software não sincroniza instruções. Preserve os textos ao formatar.
Metadados instrucoes.json, .historico/, .rascunhos/ e temporários são locais,
ignorados no Git; capturas não são cache descartável. biblioteca.json migra por
renomeação byte a byte; conflitos impedem abertura, sem backup automático.
Novas bibliotecas usam base.md com [common], [copy], [image], [animation] e
`formatos/*.md` sem rotas editáveis. library init cria só scaffold vazio;
library split mostra prévia sem efeitos; --preserve-originals aplica e arquiva
originais, exigindo autorização explícita para backup. Import/export, convert,
restore e layouts legados permanecem; não converter bibliotecas automaticamente.
O painel `/orders` cadastra pedidos e materiais e lista os números salvos. O
chat controla a fila. A configuração local mantém login e confirmação de
pareamento do executor. O Desktop conecta o worker após a confirmação do
pareamento e pelo botão Conectar Flow, usando a autorização existente e a
pausa persistida. Falhas de conexão são exibidas, sem repetição automática.
O painel oferece Limpar pedidos para retirar da lista os pedidos elegíveis.
O seletor de referências aceita várias imagens por produto, acumuladas entre
seleções e removidas individualmente. Todas entram nos materiais do pedido;
`referenceId` aponta a única imagem marcada como principal para a geração no
Flow. Não alterar esse vínculo nem os materiais de pedidos já registrados.

Uma reserva valida a biblioteca local e captura automaticamente os arquivos
usados, sem publicação manual da biblioteca. Reservas existentes e preparações publicadas
preservam suas capturas e templates. Ausência de regras aponta os arquivos
necessários, sem buscar conteúdo no código. A CLI e o MCP entregam o mesmo
contexto e os mesmos materiais verificados. O compilador não invoca IA.

Para operação, trabalhe fora do repositório e leia o contexto integral retornado
pelo MCP. Não investigue código ou containers durante uma preparação. As skills
em `skills/` são orientações técnicas para operar o MCP; a análise criativa e as
regras de copy, imagem, animação e clonagem pertencem à biblioteca local configurada.
O vídeo de clonagem é analisado pelo agente ativo; MP4 até 64 MB e imagens/documentos
até 8 MB. A foto do produto continua como referência de geração do Flow.
cloneMode=adapt-format é o padrão legado; preserve-copy exige cloneVideo.mode,
transcript conferida e copy idêntica por take e entre variações do vídeo no
produto. O agente analisa o áudio; o servidor valida igualdade sem invocar IA.
videoModel opcional no pedido aceita Omni 1.1 Flash ou Veo 3.1 Lite, aplicado a
todos os takes; ausência legada resolve Omni na compilação sem regravar registros.

O SQLite guarda registros; os materiais importados ficam em arquivos por hash
em armazenamento persistente administrado pelo aplicativo, com deduplicação.
Agente e executor local acessam materiais pela API local autorizada. Pedidos e
materiais permanecem no armazenamento administrado pela aplicação.
Exclusões de dados exigem autorização específica. Preserve a pasta global de
downloads e os resultados já registrados.

Cada variação tem três vídeos (gancho, Body, CTA). Fábrica, POV + Vendedora
(`pov`) usam duas imagens: gancho e Body; o CTA reutiliza a imagem
confirmada do Body. Full POV (`full-pov`) e Full Vendedora (`seller`) usam uma
imagem, gerada no gancho e reutilizada diretamente no Body e CTA. Nos formatos
Full, preparar somente `hookImage`, sem `presenterImage`. Na clonagem, o agente
identifica as cenas do MP4 e preenche `cloneVideo.scenePlan`: `scenes` define
IDs e imagens, e `takes.hook`, `.body` e `.cta` associam cada take à sua cena.
Uma cena repetida reutiliza diretamente a imagem do primeiro take gerador;
cenas distintas recebem imagens próprias, inclusive no CTA. Não combinar com
`hookImage`, `presenterImage` ou `imageStrategy`. O checkout entrega o mapa vazio
e o agente justifica a associação em `analysis`. Preparações anteriores mantêm
seus contratos, incluindo o par legado e `imageStrategy` quando presente.
A foto principal mantém a identidade do produto. Takes e preparações
já registrados preservam seus manifestos, materiais e autorizações.

A reutilização usa `reuseImageFrom` no manifesto, `imageSourceTaskKey` na entrada
e `sourceImage` resolvido pelo servidor. Sempre apontar ao take gerador original,
sem encadear uma reutilização em outra. Nunca gerar imagem de fallback. Validar
dono, lote, projeto, variação e materiais visuais. Take com reutilização: zero
imagens, um vídeo, quatro checkpoints iniciados por `image_reused`; take gerador:
uma imagem, um vídeo e cinco checkpoints. A reutilização e as saídas agrupadas
exigem protocolo v5 ou posterior. Novos despachos usam o protocolo v6 para
salvar `01-Gancho.mp4`, `02-Body.mp4` e `03-CTA.mp4` juntos em
`Flow/Videos/<produto>--<formato>--<identificador>/`, sem pasta de lote.
Takes já registrados mantêm o destino gravado.

Novos takes usam Nano Banana Pro e Omni 1.1 Flash Frames, frame inicial, 8 s/720p,
9:16. Nano Banana 2.1 e os parâmetros suportados podem ser usados quando pedidos.
Preservar referência original na geração da imagem e usar a imagem gerada no
vídeo. Não mudar materiais/modelos de takes registrados. POV + Vendedora usa voz fora de câmera e mãos no gancho; Full POV mantém essa
composição nos três takes, sem coro ou lip-sync visível.

Regras editoriais, duração falada, apoio físico, identidade do produto e direção
visual vêm exclusivamente das instruções locais. Os templates são texto de
entrada do compilador; o código não gera instruções criativas nem faz fallback
para conteúdo embutido. Referências fornecidas para manutenção orientam a
edição das instruções locais; cada preparação usa sua captura registrada.

Projetos do Flow são preparados automaticamente por lote e retomados pelo vínculo
persistido. Reutilizar a mesma aba, sem abrir abas adicionais por lote. Criação
sem resposta confirmada exige revisão, sem criar outra automaticamente. Não
recarregar a aba para atualizar a listagem durante execução.
`flow_review_dispatch` consulta um grupo bloqueado. `flow_resume_dispatch` exige
nova autorização explícita no chat para o grupo, preparação e hash da revisão.
Só admite falha comprovadamente anterior ao envio da criação do projeto, sem
qualquer take registrado no lote; mantém materiais e preparações imutáveis,
registra a autorização e preserva o corpo anterior. Resultados incertos, grupos
já enfileirados e identidades revogadas nunca são retomados por essa operação.
`flow_close_dispatch` encerra grupos bloqueados após solicitação explícita no
chat. `dispatch_closures` registra a decisão sem alterar corpo,
materiais, autorização ou falha originais. Grupos com takes pendentes, ativos ou
incertos e criação de projeto em andamento não podem ser encerrados. Grupos
encerrados deixam a fila e não podem receber novas gerações;
os resultados confirmados permanecem registrados. Pedidos encerrados com parte
dos vídeos pronta são informados como “Encerrado parcialmente”. `flow_clear_orders` persiste
para pedidos sem envio ou já encerrados. Nenhuma limpeza apaga materiais,
tentativas ou autorizações. Pedidos removidos não aceitam nova preparação ou
despacho. Ao esvaziar a lista, um novo ciclo recomeça em #1; números consultam o
ciclo atual e UUIDs preservam acesso histórico. Checkouts dos novos ciclos usam
subpastas por UUID para não sobrescrever arquivos de pedidos anteriores.
Use `flow_queue_status` e `flow_order_diagnostics` para mostrar etapas reais,
pausa, falha e incerteza. `flow_queue_control` pausa ou retoma trabalhos já
autorizados. A pausa persistida impede novas reservas de projeto e novos
takes. `flow_cancel_take` cancela somente takes pendentes, e
`flow_resolve_take` registra a decisão do usuário após conferir o resultado.

Validações devem distinguir contratos e fixtures de gerações reais. Testes
sintéticos verificam os cenários implementados; qualidade criativa, áudio e
sincronização da fala dependem de validação da geração correspondente.
Qualquer geração paga exige autorização específica no chat.

## Stack e organização

- Node.js 24.22.2 LTS, TypeScript estrito, pnpm Workspaces e versões exatas no
  projeto e lockfile. Não instalar ferramentas globais no host automaticamente.
- `packages/protocol`: contratos Zod e tipos compartilhados, sem dependências
  Node de execução.
- `packages/orchestrator`: Fastify, configuração Zod, persistência `node:sqlite`
  e rotas HTTP. Separe configuração, persistência, comunicação e segurança.
  O modo de execução suportado é o Compose da raiz. O conector MCP fica em
  `src/mcp`. O registro Codex usa `smol-toml`, com backup autorizado e preservação
  dos valores. Desenvolvimento e testes podem iniciar Node no host.
- `packages/desktop`: Electron 45.4.1 (`BrowserWindow` + `WebContentsView`, `preload.cjs` com `contextIsolation`, `sandbox` e `nodeIntegration: false`) executando nativamente no Windows o orquestrador, SQLite (`node:sqlite` embutido), biblioteca local, executor `flow-mcp` (com perfis isolados e login Chrome sem automação) e instalador unificado dos MCPs `flow-batch` e `flow-browser`. Empacotamento Windows em `packages/desktop/release/` via `pnpm desktop:dist:win`.
- `packages/flow-mcp`: MCP stdio do Flow e executor local com TypeScript estrito,
  MCP SDK 2.4.0, Playwright Core 1.64.1 e Zod 4.6.7, mantidos neste workspace.
  Chrome com perfil dedicado, consulta de sessão, abertura de projeto existente
  e confirmação de imagens por ID. Executa junto ao Chrome,
  fora do Compose; Node e Chrome devem rodar no mesmo sistema operacional.
  Login real usa Chrome comum, sem CDP ou Playwright durante a entrada de
  credenciais. Após o usuário concluir e fechar a janela manual, flow:connect
  abre o mesmo perfil e conecta o controle. Chrome for Testing fica restrito
  aos testes sintéticos; não comprova aceitação de login pelo Google.
  O worker recebe apenas takes imutáveis da fila, com identidade local P-256,
  confirmação explícita em /connect e protocolo v9. A chave local é própria da
  aplicação, protegida por permissão 0600 em POSIX; não é credencial do Google.
  Novos takes usam driver=browser-ui, seed=null e maxVideoCredits=25; preservar
  seeds e contratos anteriores. Conferir opções e cotação antes do envio: imagem
  exige zero créditos; vídeo respeita o limite registrado. Downloads exigem GUID
  e conclusão do Chrome, tamanho correspondente e MP4, sem sobrescrever destinos.
  Locks de worker e de operação do navegador impedem concorrência; interrupções
  exigem revisão, sem remover locks ou repetir gerações automaticamente.
- Docker Compose: orquestrador com volume persistente.
- `shared/styles/theme.css`: base visual compartilhada pelo orquestrador e pelo
  `packages/desktop`, copiada nos dois builds. Estilos específicos ficam em cada camada.
- Antes de implementar, confira o estado real do repositório e os contratos
  existentes. Preserve alterações do usuário e decisões já validadas.
- Ao definir a stack, registre aqui linguagens, versões, gerenciador de pacotes,
  camadas e responsabilidades. Documente comandos reais disponíveis no projeto.
- Separe domínio, casos de uso, integrações, persistência e interface conforme
  essas responsabilidades surgirem. Evite criar camadas sem necessidade concreta.
- Use o gerenciador e o lockfile adotados pelo projeto. Não introduza alternativas
  concorrentes ou dependências sem justificativa para a tarefa.
- Mantenha compatibilidade com o ambiente Linux/WSL quando aplicável e use
  quebras de linha Unix (LF) nos scripts de shell.

## Regras de qualidade e design

Estas regras se aplicam ao código, testes e scripts mantidos no repositório.

1. **Funções pequenas e focadas.** Cada função deve cumprir uma responsabilidade
   observável. Use cerca de 30 linhas como referência; extraia etapas quando o
   fluxo crescer, sem criar auxiliares que apenas escondam uma linha.
2. **Arquivos pequenos.** Arquivos de código mantidos manualmente devem ter no
   máximo 500 linhas, preferencialmente entre 200 e 300. Divida por responsabilidade
   coesa, sem fragmentar apenas para atingir uma contagem. Arquivos gerados,
   lockfiles e artefatos de terceiros são exceções. Arquivos legados acima do
   limite não devem crescer e devem ser divididos quando alterados materialmente.
3. **Single Responsibility Principle.** Cada módulo, classe, componente e serviço
   deve ter um único motivo para mudar. Separe regras de negócio, coordenação,
   efeitos externos e apresentação. Evite módulos genéricos `util` ou `common`
   com responsabilidades sem relação.
4. **Nomes significativos e distintos.** Use nomes pronunciáveis, pesquisáveis e
   que revelem intenção no domínio. Evite abreviações ambíguas e nomes genéricos
   como `data`, `item`, `temp` e `helper` quando houver um conceito mais preciso.
   Não reutilize o mesmo nome para conceitos diferentes.
5. **Tipos explícitos.** Declare tipos de contratos públicos, entradas e saídas
   de serviços, estados e dados serializados. Valide dados externos nas fronteiras.
   No TypeScript, use modo estrito e não use `any`; prefira tipos,
   unions, generics ou `unknown` com validação.
6. **DRY (Don't Repeat Yourself).** Mantenha uma única fonte de verdade para cada
   regra de negócio, contrato ou transformação relevante. Extraia abstrações
   quando a duplicação representar o mesmo conceito e ciclo de mudança, sem
   unificar trechos apenas superficialmente parecidos.

## Workflow de desenvolvimento e testes

Antes de implementar, identifique a camada afetada, o comportamento esperado e
os testes pertinentes. Acrescente ou ajuste cobertura proporcional ao impacto;
mudanças apenas documentais não exigem criar testes de código.

### Validação incremental por escopo

- Comece por compile/typecheck e lint da camada alterada, quando disponíveis.
- Execute os testes unitários diretamente relacionados aos arquivos modificados.
- Execute integração quando a mudança afetar contratos entre componentes, APIs,
  banco de dados ou serviços externos.
- Execute E2E para fluxos críticos afetados ou ao finalizar tarefas significativas.
- Reserve a suíte completa para mudanças grandes, refatorações estruturais ou
  risco de regressão transversal. Não a execute automaticamente após cada edição.
- Se uma etapa falhar, corrija e repita a etapa afetada antes de ampliar a validação.
- Resuma resultados de comandos extensos. Em caso de erro, mostre a falha e o
  contexto necessário, sem despejar logs completos.

### Comandos e evidências

- `pnpm mcp:install`: instala/atualiza o conector independente e a entrada
  Antigravity no ambiente atual, preserva os demais servidores e cria backups.
  Também disponível no arquivo baixado: `node flow-batch-mcp.mjs --install antigravity`.
  Instalação não prepara pedidos, não consome créditos e não encerra clientes.
- `pnpm mcp:install codex`: registra o conector em `CODEX_HOME/config.toml`
  ou `~/.codex/config.toml`, preservando os demais servidores e valores.
- `docker compose up -d --build` inicia/atualiza a aplicação em container.
  `docker compose down` para preservando o volume. Configure `FLOW_LIBRARY_DIR`
  no `.env` ignorado pelo Git.
  O Dockerfile da raiz instala versões fixadas pelo pnpm dentro da imagem e
  prepara dependências de produção; não copia módulos do host.
  Não instalar/desinstalar pacotes globais nem migrar instalações anteriores
  automaticamente durante manutenção do código.
- `pnpm desktop:dev`: abre o app desktop Electron no ambiente atual.
- `pnpm desktop:dev:win`: recompila os pacotes no WSL e abre o app desktop
  diretamente no Windows nativo (`packages/desktop/release/win-unpacked/`).
- `pnpm desktop:dist:win`: gera o pacote Windows em
  `packages/desktop/release/win-unpacked/` (`Flow Batch.exe`) e o arquivo `.zip`.
- `pnpm mcp`: conector MCP stdio; o arquivo independente é servido em
  `/agent/flow-batch-mcp.mjs`, sem editor ou página de biblioteca.
- `pnpm flow:login`: abre o Chrome dedicado para login manual.
  `pnpm flow:connect`: após concluir o login e fechar a janela manual, reabre o
  mesmo perfil com controle. Nenhuma geração é iniciada por esses comandos.
  `pnpm flow:status`: consulta a sessão sem iniciar Chrome.
  `pnpm flow:login --chrome CAMINHO` salva a localização do executável no estado
  local do aplicativo, sem backup ou alterações globais.
  `pnpm flow:mcp`: inicia o MCP de navegador, com consulta, navegação e controle
  do worker. `pnpm flow:pair` solicita conexão a confirmar pelo usuário em /connect;
  `pnpm flow:executor-status` consulta o clientId e a conexão. `pnpm flow:worker`
  executa a fila em primeiro plano; pelo MCP, flow_browser_start_worker inicia
  em segundo plano. Só recebe pedidos já autorizados para esse clientId.
  `pnpm flow:pause` pausa os próximos takes. Configure
  `FLOW_BROWSER_HOME` e `FLOW_BROWSER_CHROME` no ambiente do processo, quando necessário.
- `pnpm test:browser:flow-mcp`: consulta, grade virtual, imagens com títulos
  repetidos, navegação, configurações, prompts, reutilização e download com GUID
  em Chromium isolado com páginas e respostas sintéticas.
  O E2E do worker usa a porta 4398 e pedido sintético pelo painel até três MP4s,
  intervalo de 15 segundos e revogação sem reenvio. Exige build do workspace.
  Não comprova login ou integração com o serviço real do Google.
- `pnpm library init [PASTA]`, `seed [PASTA]`, `import [PASTA] ARQUIVO.MD_OU_JSON`,
  `export [PASTA] DESTINO.MD_OU_JSON`, `validate [PASTA]`, `convert [PASTA]`, `split [PASTA] [--preserve-originals]` e
  `restore [PASTA] REVISAO`: manutenção offline. Sem pasta explícita, usam a
  `FLOW_LIBRARY_DIR` exportada, depois `LIBRARY_DIR` ou `~/.flow-batch/biblioteca`.
  A CLI offline não lê `.env` nem configurações de instaladores anteriores.
- `pnpm test:browser:library`: inicialização vazia, importação local, painel de
  pedidos sem editor e download do conector em Chrome isolado.
- `pnpm test:browser:orders-design`: layout do editor e lista em larguras de
  320 a 1920 px, anexos e detalhes do cadastro em Chrome isolado. Verifica que
  a fila não tem controles no painel. Usa a porta 4359 e dados temporários.
- `pnpm test:browser:connect`: página de conexão em Chrome isolado, identidades
  sintéticas e WebSocket autenticado. Cobre códigos, confirmação, cancelamento,
  expiração, conexão/desconexão, revogação e nova autorização na porta 4369.
- `pnpm test:browser:session`: renovação local, concorrência, reinício, rascunho
  e arquivos preservados, erros e limite de recuperação na porta 4379.
- `pnpm orders list` / `show NUMERO`: consulta do agente pela API local.
- `pnpm orders checkout 12 15`: reserva e materiais para preparação; `--revise`
  permite revisar uma preparação ainda não despachada.
- `pnpm orders renew .cache/orders/12`: renova a reserva de preparação.
- `pnpm orders publish CAMINHO/preparacao.json --execute`: publica e despacha
  após o pedido direto no chat; sem `--execute`, só prepara para revisão.
- `pnpm orders approve NUMERO --approve`: executa uma preparação existente quando
  o usuário pedir; sem hash. `--client UUID` escolhe o executor quando necessário.
- Contrato de preparação `flow-orders/5`: publicação com execução opcional e
  biblioteca em documento único. Instruções em arquivos nunca autorizam consumo;
  o sinalizador de execução vem da chamada do agente. Verificar estado, conteúdo
  imutável e autorização do executor antes de persistir o despacho.
- `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm build`, `pnpm format:check`, `pnpm check`.
- `pnpm dev`: servidor no host somente para desenvolvimento.
- `docker compose config --quiet` / `pnpm test:docker`: configuração e integração
  em Compose isolado, com projeto, imagens, volume e porta sintéticos próprios.
  Não reutilizar imagens, porta ou dados da instalação em uso.
- `pnpm test:browser:cloning`: pedidos e clonagem no painel com mídias sintéticas.
- `docker compose up -d --build` / `docker compose down`: atualizar/iniciar/parar.

## Segurança e persistência

- Criar qualquer backup exige permissão explícita do usuário, inclusive cópias
  preventivas e backups automáticos disparados por scripts ou ferramentas.
  Autorizar uma atualização, instalação ou correção não autoriza criar backups.
- Não alterar configurações globais de Windows, WSL, Docker ou Chrome.
- Identifique instalações existentes antes de agir e preserve seus dados;
  caminhos específicos da instalação pertencem ao `.env` local ou ao perfil
  `~/.flow-batch/`.
- Servidor em `0.0.0.0` no container e publicação somente em `127.0.0.1:4319`.
  Execute sem privilégios, com raiz somente para leitura e volume SQLite próprio.
- SQLite com WAL, foreign keys, busy timeout, temporários em memória para a raiz
  somente leitura do container, migrações transacionais versionadas
  e encerramento limpo. Não usar `docker compose down -v` como parada normal.
- Materiais importados ficam no volume persistente local; não montar pastas
  arbitrárias do Windows no servidor.
- Healthchecks não expõem caminhos, arquivos ou credenciais. Valide Host e
  Origin; não habilite CORS indiscriminadamente. Gestão local exige sessão
  HttpOnly/SameSite, cabeçalho próprio e confirmação explícita em `/connect`.
  A renovação em `POST /manage/session` exige Origin exata e o cabeçalho próprio,
  preservando HttpOnly/SameSite e o vínculo com a autoridade. A sessão do painel
  não autoriza o executor. O cliente só repete uma requisição após o código
  `MANAGEMENT_SESSION_REQUIRED`, emitido antes de qualquer efeito; nunca repetir
  automaticamente após erro de rede, resultado incerto ou falha do servidor.
- ECDSA P-256 local no executor, autorização SQLite, pedidos de 2 minutos
  e desafios de 60 segundos, consumidos antes da verificação assíncrona. Assine
  método, autoridade, caminho e digest dos bytes exatos do corpo. Sem bearer.
- WebSocket exige Origin local autorizada e autenticação na primeira mensagem
  com prazo limitado. Não enviar credenciais pela URL. Revogação encerra conexões
  e impede tentativas automáticas. Simulações interrompidas não são reenviadas.
- A fila tem um único trabalho ativo globalmente. Persista a intenção antes do
  envio, vincule eventos à tentativa e à conexão e ignore mensagens atrasadas.
  Interrupções após a intenção de envio geram resultado incerto e bloqueiam novos
  despachos até revisão explícita; reconexão não autoriza reenvio.
- Takes reais exigem autorização vinculada à entrada imutável para uma imagem e
  um vídeo, ou zero imagens e um vídeo quando reutilizam a imagem confirmada do
  Body, com uma tentativa por autorização. Persistir checkpoints dos IDs de
  cada etapa. Uma nova tentativa do take exige confirmação explícita do operador
  após verificar a falha no Flow e protocolo v8 para recarregar a mesma aba
  do projeto antes do envio. Se o take já possui imagem gerada registrada em
  tentativa anterior, a autorização usa zero imagens e um vídeo, via
  `image_reused` com o próprio take como origem. Use o último checkpoint
  `image_generated` válido do próprio take e pare se a imagem não puder ser
  confirmada no Flow. Aguarde 15 s entre o download confirmado de um
  take e o início do próximo take real. Preserve entrada, tentativas e autorizações
  anteriores. Repetição automática exige autorização prévia do pedido, limite de
  uma tentativa extra por take e falha comprovadamente anterior ao envio. Não gerar novamente quando o vídeo
  já foi localizado e não retomar grupo encerrado ou identidade revogada.
  Recusa `flow_unsafe_generation` permite seguir os próximos takes independentes
  e exige revisão do conteúdo para repetir o take recusado.
  `flow_retry_take` autoriza outra tentativa com o conteúdo existente após
  falha confirmada no Flow e autorização explícita no chat para o orçamento
  informado. Preserve a pausa, salvo quando o usuário também pedir retomada.
  `flow_review_take` entrega a captura da preparação e o histórico;
  `flow_prepare_take_revision` salva uma versão imutável de copy e prompt de
  vídeo ligada à tentativa anterior e à imagem confirmada. O pedido direto de
  revisão do take no chat já autoriza revisar e gerar uma única nova tentativa
  com a imagem existente, com zero imagens e um vídeo. Use
  `flow_prepare_take_revision` com `execute=true` e `userAuthorized=true`,
  sem confirmação adicional. “Apenas revisar”, “preparar”, “para aprovação” ou “não execute”
  exige `execute=false`; `flow_approve_take_revision` executa a versão preparada
  quando o usuário pedir. Uma nova falha exige nova decisão no chat.
  Preserve a entrada original e
  resolva os textos por tentativa no despacho e no diagnóstico. Falas de
  `preserve-copy` continuam idênticas à referência conferida.
  Conclusão exige download confirmado pelo Chrome e evidência correspondente;
  não aceitar conclusão manual simulada de uma tarefa real.
- Repetição automática de simulações somente para falha comprovadamente anterior ao envio,
  com espera progressiva e orçamento de tentativas. Preserve materiais originais,
  todas as tentativas e eventos. Não prometa execução exatamente uma vez.
- Conceda permissões de Flow, scripting, sidePanel e downloads conforme as
  funcionalidades implementadas exigirem. Restrinja os hosts aos necessários.
  Não exporte cookies, tokens de sessão ou reCAPTCHA ao orquestrador, logs ou UI.
  Mantenha a autorização local e o tratamento de resultados incertos da fila.
  A retirada das restrições da integração não autoriza expor o servidor na rede,
  apagar dados ou alterar configurações globais.
- Preserve licenças e atribuições do código incorporado, conforme `THIRD_PARTY_NOTICES.md`.
- Testes não usam perfil pessoal do Chrome. Validação Windows/Chrome real deve
  ser registrada separadamente de testes HTTP e containers.

Antes de concluir uma entrega ou criar um commit solicitado, execute as
verificações pertinentes disponíveis. Informe o que foi validado e o que ficou
pendente. Testes com mocks, fixtures ou adapters fake não comprovam integração
real, execução no navegador ou funcionamento de serviços externos.

## Documentação e memória

- Mantenha visão do produto, estado atual, configuração e comandos de uso no
  `README.md` da raiz. Este arquivo reúne regras de
  desenvolvimento, organização e validação; evite duplicar orientações.
- Consulte o agentmemory antes de retomar decisões ou investigações anteriores.
  Confira a proveniência do projeto e a validade das informações no código atual.
- Registre decisões duráveis com motivo, limitações e contexto do projeto.
  Diferencie propostas, registros históricos e funcionalidades implementadas.
- Prefira agentmemory para pesquisas e handoffs; mantenha no repositório a
  documentação operacional necessária. Não crie relatórios de sessão sem pedido.
- Nunca envie segredos, tokens, credenciais ou dados sensíveis para memória,
  documentação ou logs. Não versione `.env` reais, chaves privadas ou certificados
  privados. Exemplos de configuração devem usar valores fictícios.
- Preserve dados do usuário e caches necessários ao desenvolvimento. Artefatos
  gerados e logs temporários devem ser ignorados pelo Git quando forem introduzidos.

## Convenções de commit

Não crie commits nem envie alterações sem solicitação do usuário. Quando
solicitado, revise o diff e corrija falhas das verificações exigidas antes do commit.

Separe alterações pendentes por feature em commits lógicos e revisáveis,
incluindo os testes e a documentação correspondentes. Mudanças independentes
devem ter commits próprios. Não reúna features distintas em um único commit,
salvo solicitação explícita do usuário.

Use Conventional Commits com mensagens em inglês:

- `feat:` nova funcionalidade.
- `fix:` correção de bug.
- `refactor:` refatoração sem mudança funcional.
- `test:` alterações de testes.
- `docs:` documentação.
- `chore:` manutenção e configuração.
