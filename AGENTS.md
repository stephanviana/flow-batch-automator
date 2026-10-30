# Flow Batch Automator

Estas regras valem para todo o repositório. Instruções mais específicas de uma
camada continuam válidas dentro dela, respeitando as instruções do usuário.

## O que é este projeto

Ferramenta local para gerar imagens e vídeos em lote no Google Flow e baixar os
MP4s, reduzindo o trabalho manual. As Fases 1, 2 e 3 foram verificadas e aprovadas
pelo usuário, incluindo conexão, três takes simulados sequenciais e histórico no
Chrome do Windows. A **Fase 4 — Integração com Flow** foi implementada usando o
FlowKit como referência e um side panel como interface. O usuário confirmou o
primeiro take real: **“Concluiu e baixou o MP4”**. A conferência do SQLite mostrou
uma tentativa concluída e os cinco checkpoints do percurso completo. O importador
de lotes da Fase 5 ainda não foi implementado.

A divisão por projetos foi implementada na versão 0.4.3: um projeto do Flow por lote, com
vínculo persistente para retomadas. Novos lotes criam um projeto por padrão;
também é possível vincular um projeto existente. Takes antigos mantêm o projeto
original. Uma criação sem resposta confirmada exige revisão, sem criar outro
projeto automaticamente. A criação do projeto não autoriza gerar mídia paga.
O usuário pediu reutilizar a mesma aba do Flow, voltando à página inicial para
criar o projeto e navegando nela até o projeto do lote. Não abrir abas adicionais
para os lotes. Trocas manuais exigem fila pausada/ociosa; a execução pode navegar
entre projetos antes de iniciar o próximo take, sem interromper o atual.
O usuário validou o novo fluxo na conta real do Flow: **“Testei o novo fluxo e
está funcionando corretamente.”** A divisão por projetos está aprovada; não
atribuir a essa confirmação testes reais específicos de interrupção/recuperação.

Antes da Fase 5, o usuário pediu Omni 1.1 Flash e confirmou o modo **Frames,
somente frame inicial**. Imagem: Nano Banana Pro ou Nano Banana 2.1. Use a imagem
gerada como frame inicial, preservando a referência original na etapa de imagem.
Omni deve ser o padrão de novos takes (8 s, 720p), com os tempos 4/6/8/10 s e
resoluções 360p/720p suportados pelo FlowKit. Não mudar modelos ou parâmetros de
takes já registrados; a Fase 5 permanece pendente.
O usuário confirmou **“Gerei com Omni e baixou o MP4”** na versão 0.4.1. O take
`abra_i2v_8s` (Omni Frames, 8 s/720p) ficou concluído em uma tentativa, com os cinco
checkpoints. Outras durações e resoluções têm cobertura com fixtures; não atribuir
a elas essa validação real.

O usuário também pediu feedback visual ao processar a fila. O painel deve
responder imediatamente ao clique e mostrar as etapas reais até o download,
incluindo pausa, falha e resultado incerto; não inventar percentual de geração.
As chamadas diretas não sincronizam a listagem da página do Flow. Não recarregar
a aba automaticamente durante uma execução para tentar atualizar essa listagem.

O usuário retirou as restrições anteriores contra APIs privadas e integração no
contexto autenticado da aba. Chamadas batchexecute com a sessão da própria conta
estão autorizadas; não exigir automação por cliques como única alternativa.
Reaproveite a fila existente e concentre o desenvolvimento no caminho mínimo:
referência → imagem → vídeo → MP4. Não ampliar infraestrutura, provedores de IA,
dashboard, TTS ou publicação em redes sociais. Executar gerações que consomem
créditos continua dependendo de confirmação explícita; implementar e testar os
adaptadores sem consumir créditos está autorizado.

Use projetos e sessões anteriores como referência de organização e qualidade.
Não atribua a este repositório funcionalidades, dependências, autorizações ou
validações de outros projetos, inclusive daqueles com nomes semelhantes.

## Stack e organização

- Node.js 24.22.2 LTS, TypeScript estrito, pnpm Workspaces e versões exatas no
  projeto e lockfile. Não instalar ferramentas globais no host automaticamente.
- `packages/protocol`: contratos Zod e tipos compartilhados, sem dependências
  Node de execução; não antecipar contratos de fases futuras.
- `packages/orchestrator`: Fastify, configuração Zod, persistência `node:sqlite`
  e rotas HTTP. Separe configuração, persistência, comunicação e segurança.
- `packages/extension`: Chrome Manifest V3, Chrome 120+, side panel e service worker
  empacotados com esbuild. Identidade em IndexedDB; storage e alarms para estado
  de conexão e recuperação. Referências locais em IndexedDB separado, com SHA-256;
  bytes das imagens não passam pelo orquestrador. A integração executa RPCs no contexto da aba do Flow,
  aproveitando sua sessão; credenciais e tokens permanecem no navegador.
- Docker Compose: orquestrador e serviço temporário `sync-extension`. Sem Redis,
  PostgreSQL, dashboard completo ou serviços externos adicionais.
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

- `pnpm install --frozen-lockfile`: instalação reproduzível.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`: verificações por workspace.
- `pnpm build`: build dos três pacotes em ordem de dependência.
- `pnpm format:check` e `pnpm check`: formatação e validação completa.
- `pnpm dev`: servidor local; `pnpm start`: servidor compilado.
- `docker compose config --quiet`: validação da configuração de containers.
- `pnpm test:docker`: integração real em projeto Compose e volume novos, com a
  porta 4319 livre; preserva o volume sintético e deixa os logs em `.cache/`.
- `pnpm test:browser:flow`: executor com referência e MP4 em fixtures HTTPS
  locais, sem Google real; OpenSSL e flags só no perfil isolado de teste.
- `pnpm test:browser`: extensão real em Chrome for Testing com perfil e banco
  novos em `.cache/`, sem perfil pessoal. Exige navegador local de teste instalado
  e porta 4319 livre; não instala bibliotecas globais automaticamente.
- Iniciar, atualizar e parar: `docker compose up -d`,
  `docker compose up -d --build`, `docker compose down`.

## Segurança e persistência

- Não alterar configurações globais de Windows, WSL, Docker ou Chrome.
- Identifique instalações anteriores antes de agir; não apague seus dados.
  O usuário informou que removeu a instalação anterior e fixou o destino da
  extensão em `C:\Users\stephan\flow-batch-extension`, correspondente a
  `/mnt/c/Users/stephan/flow-batch-extension` no WSL.
- Servidor em `0.0.0.0` no container e publicação somente em `127.0.0.1:4319`.
  Execute sem privilégios, com raiz somente para leitura e volume SQLite próprio.
- SQLite com WAL, foreign keys, busy timeout, migrações transacionais versionadas
  e encerramento limpo. Não usar `docker compose down -v` como parada normal.
- Entrada somente para leitura; o orquestrador não acessa a pasta Windows.
  `sync-extension` não tem rede e escreve somente no destino montado.
- Healthchecks não expõem caminhos, arquivos ou credenciais. Valide Host e
  Origin; não habilite CORS indiscriminadamente. Gestão local exige sessão
  HttpOnly/SameSite, cabeçalho próprio e confirmação explícita em `/connect`.
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
  um vídeo, com tentativa única. Persistir checkpoints dos IDs de cada etapa.
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

Use Conventional Commits com mensagens em inglês:

- `feat:` nova funcionalidade.
- `fix:` correção de bug.
- `refactor:` refatoração sem mudança funcional.
- `test:` alterações de testes.
- `docs:` documentação.
- `chore:` manutenção e configuração.
