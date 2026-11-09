# Flow Batch Automator

Estas regras valem para todo o repositório. Instruções mais específicas de uma
camada continuam válidas dentro dela, respeitando as instruções do usuário.

## O que é este projeto

Ferramenta local para a operação de TikTok Shop: o usuário monta pedidos no painel,
o agente cria copy e prompts, a API coordena a fila e a extensão executa no Google
Flow. FlowKit é referência técnica, não define o produto como ferramenta de YouTube.

A arquitetura 0.6.0 usa painel em `/orders`, com produtos, materiais selecionados
de qualquer pasta, formatos e quantidades por produto. Não há presets nesta
etapa. O usuário pede ao Codex/Antigravity que prepare um ou vários números de
pedido. Prefira o MCP local: `flow_list_orders`, `flow_checkout`, `flow_publish`
e `flow_approve`. O pedido direto “prepare o pedido N” inclui preparar e executar
os números selecionados no chat, nos formatos e quantidades do pedido, sem outra
confirmação nem hash de aprovação. Use `flow_publish` com `execute=true` e
`userAuthorized=true`; “apenas prepare”, “para revisão” ou “não execute” exige
`execute=false`. Para executar uma preparação existente, `flow_approve` usa só
número, autorização e extensão opcional. Isso não autoriza gerações nesta tarefa
de manutenção nem retomadas automáticas após falha.
A biblioteca criativa versionada está em `instrucoes/`: base.md e oito arquivos
`formatos/*.md`. O npm distribui esses textos sem segredos; setup instala a edição
na pasta configurada apenas quando nova ou com scaffold modular vazio sem capturas.
Conteúdo local existente, incompleto ou legado é preservado. O runtime usa
somente LIBRARY_DIR (Compose: FLOW_LIBRARY_DIR), sem fallback no checkout/pacote.
Atualizar o software não sincroniza instruções. Preserve os textos ao formatar.
Metadados instrucoes.json, .historico/, .rascunhos/ e temporários são locais,
ignorados no Git; capturas não são cache descartável. biblioteca.json migra por
renomeação byte a byte; conflitos impedem abertura, sem backup automático.
Novas bibliotecas usam base.md com [common], [copy], [image], [animation] e
`formatos/*.md` sem rotas editáveis. library init cria só scaffold vazio;
library split mostra prévia sem efeitos; --preserve-originals aplica e arquiva
originais, exigindo autorização explícita para backup. Import/export, convert,
restore e layouts legados permanecem; não converter bibliotecas automaticamente.
O painel `/orders` mantém pedidos e andamento, sem editor de instruções.
O seletor de referências aceita várias imagens por produto, acumuladas entre
seleções e removidas individualmente. Todas entram nos materiais do pedido;
`referenceId` aponta a única imagem marcada como principal para a geração no
Flow. Não alterar esse vínculo nem os materiais de pedidos já registrados.

Uma reserva valida o pacote local e captura automaticamente os arquivos usados,
sem publicação manual da biblioteca. Reservas existentes e preparações publicadas
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
Agente e extensão acessam materiais pela API local autorizada. Não depender de
workspace Windows, symlink, seletor de pasta vinculada, caixa `.dispatch`,
`setup.sh` ou importação manual de manifesto para novos pedidos. O usuário
explicitamente autorizou remover o código/configuração antigos, os materiais do
workspace anterior e seu histórico SQLite durante esta mudança. Essa limpeza
pontual não autoriza exclusões futuras. Não alterar a pasta global de downloads.

Cada variação tem três vídeos (gancho, Body, CTA). Fábrica, POV + Vendedora
(`pov`) e clonagem usam duas imagens: gancho e Body; o CTA reutiliza a imagem
confirmada do Body. Full POV (`full-pov`) e Full Vendedora (`seller`) usam uma
imagem, gerada no gancho e reutilizada diretamente no Body e CTA. Nos formatos
Full, preparar somente `hookImage`, sem `presenterImage`. Takes e preparações
já registrados preservam seus manifestos, materiais e autorizações.

A reutilização usa `reuseImageFrom` no manifesto, `imageSourceTaskKey` na entrada
e `sourceImage` resolvido pelo servidor. Sempre apontar ao take gerador original,
sem encadear uma reutilização em outra. Nunca gerar imagem de fallback. Validar
dono, lote, projeto, variação e materiais visuais. Take com reutilização: zero
imagens, um vídeo, quatro checkpoints iniciados por `image_reused`; take gerador:
uma imagem, um vídeo e cinco checkpoints. Protocolo v5 obrigatório para
reutilização e saídas agrupadas. MP4s separados na mesma pasta da variação:
`01-Gancho.mp4`, `02-Body.mp4`, `03-CTA.mp4`.

Novos takes usam Nano Banana Pro e Omni 1.1 Flash Frames, frame inicial, 8 s/720p,
9:16. Nano Banana 2.1 e os parâmetros suportados podem ser usados quando pedidos.
Preservar referência original na geração da imagem e usar a imagem gerada no
vídeo. Não mudar materiais/modelos de takes registrados. POV + Vendedora usa voz fora de câmera e mãos no gancho; Full POV mantém essa
composição nos três takes, sem coro ou lip-sync visível.

Regras editoriais, duração falada, apoio físico, identidade do produto e direção
visual vêm exclusivamente das instruções locais. Os templates são texto de
entrada do compilador; o código não gera instruções criativas nem faz fallback
para conteúdo embutido. Swipes podem ser fornecidos como referência em uma
conversa de manutenção, sem pasta de swipes nem dependência de execução.

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
O painel oferece encerramento explícito de grupos bloqueados com um clique,
sem campo de nota ou confirmação adicional. `dispatch_closures` registra a decisão sem alterar corpo,
materiais, autorização ou falha originais. Grupos com takes pendentes, ativos ou
incertos e criação de projeto em andamento não podem ser encerrados. Grupos
encerrados deixam o despacho da extensão e não podem receber novas gerações;
os resultados confirmados permanecem registrados. Pedidos encerrados com parte
dos vídeos pronta exibem “Encerrado parcialmente”. A limpeza do painel persiste
para pedidos sem envio ou já encerrados e também limpa seus takes finalizados
na extensão. A extensão limpa concluídos, falhos e cancelados da lista e dos
totais, mantendo pendentes, ativos e incertos. Nenhuma limpeza apaga materiais,
tentativas ou autorizações. Pedidos removidos não aceitam nova preparação ou
despacho. Ao esvaziar a lista, um novo ciclo recomeça em #1; números consultam o
ciclo atual e UUIDs preservam acesso histórico. Checkouts dos novos ciclos usam
subpastas por UUID para não sobrescrever arquivos de pedidos anteriores.
Mostrar etapas reais, pausa, falha e incerteza; não inventar percentual.

As Fases 1–4 e o piloto anterior tiveram validações reais no Chrome Windows,
incluindo Omni Frames 8 s/720p e download de MP4. O piloto Fábrica Padrão de três
takes comprovou o percurso técnico, não aprovação criativa, fala exata ou lip-sync.
Body e CTA tinham apresentadoras diferentes; a correção de reutilização foi
verificada com fixtures e não herda validação paga do piloto. O áudio POV ainda
não foi validado na conta real. Testes sintéticos da arquitetura nova não
comprovam novo teste pago. Implementar/testar sem créditos está autorizado;
qualquer geração paga continua dependendo de autorização específica no chat.

## Stack e organização

- Node.js 24.22.2 LTS, TypeScript estrito, pnpm Workspaces e versões exatas no
  projeto e lockfile. Não instalar ferramentas globais no host automaticamente.
- `packages/protocol`: contratos Zod e tipos compartilhados, sem dependências
  Node de execução; não antecipar contratos de fases futuras.
- `packages/orchestrator`: Fastify, configuração Zod, persistência `node:sqlite`
  e rotas HTTP. Separe configuração, persistência, comunicação e segurança.
  `src/local-cli` configura a instalação WSL, registra os clientes MCP
  e gerencia Compose fora do checkout; dados ficam fora do prefixo npm.
  Windows usa `runtime=native` por padrão, sem Docker/WSL. Linux/WSL mantém
  Docker por padrão e admite `--runtime native`. Configurações antigas preservam
  Docker. O modo nativo inicia Node detached, sem shell, e usa controle local
  autenticado (named pipe Windows, socket abstrato Linux) vinculado à pasta de
  dados, adquirido antes de abrir SQLite. Não parar por PID nem por sinais Windows.
  Não criar serviços, tarefas agendadas ou autostart. Não migrar volumes Docker
  nem apagar dados automaticamente ao mudar o runtime.
  O registro Codex usa `smol-toml`, com backup e preservação dos valores.
- `packages/extension`: Chrome Manifest V3, Chrome 120+, side panel e service worker
  empacotados com esbuild. Identidade em IndexedDB; storage e alarms para estado
  de conexão e recuperação. Referências de execução em IndexedDB separado, com SHA-256;
  materiais importados passam pela API local e ficam em arquivos persistentes. A integração executa RPCs no contexto da aba do Flow,
  aproveitando sua sessão; credenciais e tokens permanecem no navegador.
- Docker Compose: orquestrador e serviço temporário `sync-extension`. Sem Redis,
  PostgreSQL, dashboard completo ou serviços externos adicionais.
- `shared/styles/theme.css`: base visual compartilhada pelo orquestrador e pela
  extensão, copiada nos dois builds. Estilos específicos ficam em cada camada.
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
- Distribuição npm: `@nahpets01-org/flow-batch-automator`, acesso público. A
  decisão atual substitui a distribuição exclusivamente local privada. Somente
  o manifesto de distribuição é publicável; raiz e workspaces ficam privados.
- `pnpm package:npm` compila e gera o `.tgz` auditado em `dist/npm`, sem publicar.
  `pnpm package:local` é um alias. `packaging/npm.json` define o destino e a
  visibilidade; `packaging/npm-files.json`, os únicos arquivos permitidos.
- A distribuição 0.6.1 usa arquivos compilados e dependências npm normais,
  sem `app.tar.gz` ou `node_modules` embutido. `runtime/package-lock.json` é gerado
  exclusivamente para o artefato a partir da árvore de produção do lockfile
  pnpm, com versões, URLs e integridades verificadas. O protocolo privado é
  incorporado ao código; MCP independente e extensão preservam seus bundles.
- `pnpm audit:npm` verifica manifesto, arquivos, lockfile de produção, caminhos pessoais,
  padrões de segredos, links, metadados e source maps. Não imprimir achados que
  revelem valores sensíveis. Preservar as licenças de terceiros. O Docker faz
  `npm ci` com o lockfile de produção e não recebe os módulos instalados no host.
- `pnpm publish:npm --dry-run` simula; `pnpm publish:npm` audita uma cópia exata
  antes da publicação no destino configurado. Autenticação somente local, sem
  tokens no chat, documentação ou pacote. Não publicar raiz ou implantação.
- `flow-batch setup --extension PASTA [--library PASTA]`: configura a instalação
  WSL e registra Antigravity/Codex. `up`, `down`, `status`, `logs` e `doctor`
  operam o Compose; `down` mantém o volume. Não executar instalação global nem
  adotar dados existentes durante testes; usar HOME/prefixo/volume sintéticos.
- `setup --runtime native [--data PASTA]`: execução direta no Node; padrão de
  novas instalações Windows. `up`, `down`, `status`, `logs`, `doctor` usam o
  runtime salvo. Biblioteca, SQLite e materiais ficam fora do prefixo npm.
  Encerre antes de atualizar o pacote ou mudar runtime, porta ou pastas. O modo
  nativo mantém o HTTP em `127.0.0.1`, com a mesma segurança e fila do Compose.
  Metadados de controle podem conter segredo local; nunca imprimir ou distribuir
  `native.json`. Status e health não retornam esse segredo.
- `pnpm test:package:native`: instalação npm e ciclo nativo completo em pastas
  temporárias, com MCP, SQLite, materiais e reinstalação sem Docker no PATH.
  `--windows` acrescenta execução real por Node Windows; no WSL usa a
  interoperabilidade e uma cópia portátil de Node 24.22.2 validada por SHA-256,
  sem substituir o Node instalado. Configuração, HOME, USERPROFILE e prefixo npm
  do teste são sintéticos. `FLOW_TEST_WINDOWS_NODE` escolhe o executável inicial.
- `pnpm test:package` valida instalação npm com dependências do registro em
  prefixo temporário, versões diretas, MCP, stdio e reinstalação offline.
  `pnpm test:package --docker` acrescenta Compose isolado, painel HTTP, árvore de
  produção fixada e persistência entre `down`/`up`, sem créditos.
  `FLOW_TEST_NPM=CAMINHO` seleciona outra versão do npm somente nesse teste.
- `pnpm mcp`: conector MCP stdio; o arquivo independente é servido em
  `/agent/flow-batch-mcp.mjs`, sem editor ou página de biblioteca.
- `pnpm library init [PASTA]`, `import [PASTA] ARQUIVO.MD_OU_JSON`,
  `export [PASTA] DESTINO.MD_OU_JSON`, `validate [PASTA]`, `convert [PASTA]`, `split [PASTA] [--preserve-originals]` e
  `restore [PASTA] REVISAO`: manutenção offline. Sem pasta explícita, usam a
  instalação configurada ou `~/.flow-batch/biblioteca`.
- `pnpm test:browser:library`: inicialização vazia, importação local, painel de
  pedidos sem editor e download do conector em Chrome isolado.
- `pnpm test:browser:orders-design`: layout do editor e acompanhamento, larguras
  de 320 a 1920 px, anexos, prévia, detalhes, cancelamento e armazenamento em
  Chrome isolado, sem despachar pedidos. Usa a porta 4359 e dados temporários.
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
  o usuário pedir; sem hash. `--client UUID` escolhe a extensão quando necessário.
- Contrato de preparação `flow-orders/5`: publicação com execução opcional e
  biblioteca em documento único. Instruções em arquivos nunca autorizam consumo;
  o sinalizador de execução vem da chamada do agente. Verificar estado, conteúdo
  imutável e autorização da extensão antes de persistir o despacho.
- `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm build`, `pnpm format:check`, `pnpm check`.
- `pnpm dev` / `pnpm start`: servidor local.
- `docker compose config --quiet` / `pnpm test:docker`: configuração e integração
  em Compose isolado, com volume sintético próprio e porta 4319 livre.
- `pnpm test:browser:orders` / `pnpm test:browser:reuse` /
  `pnpm test:browser:formats`: pedidos pelo painel,
  preparação, despacho, reutilização e downloads em Chrome for Testing com fixtures.
- `pnpm test:browser:queue-design`: assets compilados da extensão em Chrome com
  snapshots sintéticos, layout de 280 a 640 px, etapas, tempo, pausa e revisão.
  Não inicia servidor nem despacha pedidos.
- `pnpm test:browser:queue` / `pnpm test:browser`: fila e percurso completo em
  perfil isolado. Não instalar bibliotecas globais nem usar o perfil pessoal.
- `docker compose up -d --build` / `docker compose down`: atualizar/iniciar/parar.

## Segurança e persistência

- Criar qualquer backup exige permissão explícita do usuário, inclusive cópias
  preventivas e backups automáticos disparados por scripts ou ferramentas.
  Autorizar uma atualização, instalação ou correção não autoriza criar backups.
- Não alterar configurações globais de Windows, WSL, Docker ou Chrome.
- Identifique instalações anteriores antes de agir; não apague seus dados.
  O usuário informou que removeu a instalação anterior e fixou o destino da
  extensão em `C:\Users\stephan\flow-batch-extension`, correspondente a
  `/mnt/c/Users/stephan/flow-batch-extension` no WSL.
- Servidor em `0.0.0.0` no container e publicação somente em `127.0.0.1:4319`.
  Execute sem privilégios, com raiz somente para leitura e volume SQLite próprio.
- SQLite com WAL, foreign keys, busy timeout, temporários em memória para a raiz
  somente leitura do container, migrações transacionais versionadas
  e encerramento limpo. Não usar `docker compose down -v` como parada normal.
- Materiais importados ficam no volume persistente local; não montar pastas
  arbitrárias do Windows no servidor. `sync-extension` não tem rede e escreve
  somente no destino montado.
- Healthchecks não expõem caminhos, arquivos ou credenciais. Valide Host e
  Origin; não habilite CORS indiscriminadamente. Gestão local exige sessão
  HttpOnly/SameSite, cabeçalho próprio e confirmação explícita em `/connect`.
  A renovação em `POST /manage/session` exige Origin exata e o cabeçalho próprio,
  preservando HttpOnly/SameSite e o vínculo com a autoridade. A sessão do painel
  não autoriza a extensão. O cliente só repete uma requisição após o código
  `MANAGEMENT_SESSION_REQUIRED`, emitido antes de qualquer efeito; nunca repetir
  automaticamente após erro de rede, resultado incerto ou falha do servidor.
- ECDSA P-256 não exportável na extensão, autorização SQLite, pedidos de 2 minutos
  e desafios de 60 segundos, consumidos antes da verificação assíncrona. Assine
  método, autoridade, caminho e digest dos bytes exatos do corpo. Sem bearer.
- WebSocket exige Origin exata da extensão e autenticação na primeira mensagem
  com prazo limitado. Não enviar credenciais pela URL. Revogação encerra conexões
  e impede tentativas automáticas. Simulações interrompidas não são reenviadas.
- A fila tem um único trabalho ativo globalmente. Persista a intenção antes do
  envio, vincule eventos à tentativa e à conexão e ignore mensagens atrasadas.
  Interrupções após a intenção de envio geram resultado incerto e bloqueiam novos
  despachos até revisão explícita; reconexão não autoriza reenvio.
- Takes reais exigem autorização vinculada à entrada imutável para uma imagem e
  um vídeo, ou zero imagens e um vídeo quando reutilizam a imagem confirmada do
  Body, com tentativa única. Persistir checkpoints dos IDs de cada etapa.
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
- Código adaptado do FlowKit deve preservar sua licença MIT e atribuição.
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
