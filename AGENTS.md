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
pedido. Consulte `skills/flow-orders/SKILL.md` e `agents/instrucoes.md` antes de
preparar. As instruções criativas permanecem versionadas em `agents/`.
O compilador não invoca IA; o agente ativo analisa os materiais reais e cria os
textos e prompts. POV e Full Vendedora ainda aguardam suas bases de copy próprias.

O modo **Clonar formato de vídeo** associa um MP4 do produto a cada grupo
`clone`. Leia `agents/clonagem.md`: o agente analisa o vídeo real e publica
análise e direções adaptadas; o compilador não invoca IA. A foto continua como
referência do Flow. MP4 até 64 MB; imagens/documentos até 8 MB.
No painel, cada produto usa um único MP4, vinculado automaticamente à clonagem.
Outra referência de vídeo deve ser preparada em outro pedido/lote.

O SQLite guarda registros; os materiais importados ficam em arquivos por hash
em armazenamento persistente administrado pelo aplicativo, com deduplicação.
Agente e extensão acessam materiais pela API local autorizada. Não depender de
workspace Windows, symlink, seletor de pasta vinculada, caixa `.dispatch`,
`setup.sh` ou importação manual de manifesto para novos pedidos. O usuário
explicitamente autorizou remover o código/configuração antigos, os materiais do
workspace anterior e seu histórico SQLite durante esta mudança. Essa limpeza
pontual não autoriza exclusões futuras. Não alterar a pasta global de downloads.

Cada variação tem duas imagens novas e três vídeos (gancho, Body, CTA). O CTA
reutiliza exatamente a imagem confirmada do Body, com `reuseImageFrom` no
manifesto, `imageSourceTaskKey` na entrada e `sourceImage` resolvido pelo servidor.
Nunca gerar uma imagem de fallback. Validar dono, lote, projeto, variação e
materiais visuais. CTA: zero imagens, um vídeo, quatro checkpoints iniciados por
`image_reused`; gancho/Body: cinco checkpoints. Protocolo v5 obrigatório para
reutilização e saídas agrupadas. MP4s separados na mesma pasta da variação:
`01-Gancho.mp4`, `02-Body.mp4`, `03-CTA.mp4`.

Novos takes usam Nano Banana Pro e Omni 1.1 Flash Frames, frame inicial, 8 s/720p,
9:16. Nano Banana 2.1 e os parâmetros suportados podem ser usados quando pedidos.
Preservar referência original na geração da imagem e usar a imagem gerada no
vídeo. Não mudar materiais/modelos de takes registrados. O gancho POV usa voz
fora de câmera e somente mãos visíveis, sem coro ou lip-sync visível.

A copy de fábrica segue a fonte corrigida incorporada em `agents/copy.md`:
reação comercial + produto + motivo de compra, com vantagem comercial e fechamento
avaliativo curto integrado à frase. O usuário aprovou “por um precinho incrível”
como exemplo, sem tornar a expressão obrigatória. Preservar gancho de venda,
argumento concreto e CTA de compra. Não usar preço monetário explícito nem inventar
promoção, urgência, estoque, popularidade, desconto ou oferta oficial da plataforma.
Não bloquear a copy por falta de condição promocional; adaptar com descoberta e
apelo comercial. Não transferir quantidade/capacidade de exemplos ao produto.
Swipes brutos não são dependências de execução nem materiais a versionar.

Nas imagens de Body/CTA, produto diretamente no balcão ou nas mãos da vendedora.
Não inventar bandeja, cesta, tábua ou base portátil. Preservar acessórios reais
confirmados. Kits grandes ficam no balcão sem desmontar a unidade comercial;
a animação preserva esse apoio. Revisões exigem novos materiais conferidos e
autorização antes de consumo. Não atribuir validação de políticas à revisão.

Projetos do Flow são preparados automaticamente por lote e retomados pelo vínculo
persistido. Reutilizar a mesma aba, sem abrir abas adicionais por lote. Criação
sem resposta confirmada exige revisão, sem criar outra automaticamente. Não
recarregar a aba para atualizar a listagem durante execução. Mostrar etapas reais,
pausa, falha e incerteza; não inventar percentual.

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
- `packages/extension`: Chrome Manifest V3, Chrome 120+, side panel e service worker
  empacotados com esbuild. Identidade em IndexedDB; storage e alarms para estado
  de conexão e recuperação. Referências de execução em IndexedDB separado, com SHA-256;
  materiais importados passam pela API local e ficam em arquivos persistentes. A integração executa RPCs no contexto da aba do Flow,
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

- `pnpm orders list` / `show NUMERO`: consulta do agente pela API local.
- `pnpm orders checkout 12 15`: reserva e materiais para preparação; `--revise`
  permite revisar uma preparação ainda não despachada.
- `pnpm orders renew .cache/orders/12`: renova a reserva de preparação.
- `pnpm orders publish CAMINHO/preparacao.json`: valida e publica, sem consumo.
- `pnpm orders approve NUMERO --approve --hash HASH`: somente após autorização
  no chat para a revisão exata; `--client UUID` escolhe a extensão quando necessário.
- `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm build`, `pnpm format:check`, `pnpm check`.
- `pnpm dev` / `pnpm start`: servidor local.
- `docker compose config --quiet` / `pnpm test:docker`: configuração e integração
  em Compose isolado, com volume sintético próprio e porta 4319 livre.
- `pnpm test:browser:orders` / `pnpm test:browser:reuse`: pedidos pelo painel,
  preparação, despacho, reutilização e downloads em Chrome for Testing com fixtures.
- `pnpm test:browser:queue` / `pnpm test:browser`: fila e percurso completo em
  perfil isolado. Não instalar bibliotecas globais nem usar o perfil pessoal.
- `docker compose up -d --build` / `docker compose down`: atualizar/iniciar/parar.

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
- Materiais importados ficam no volume persistente local; não montar pastas
  arbitrárias do Windows no servidor. `sync-extension` não tem rede e escreve
  somente no destino montado.
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

Use Conventional Commits com mensagens em inglês:

- `feat:` nova funcionalidade.
- `fix:` correção de bug.
- `refactor:` refatoração sem mudança funcional.
- `test:` alterações de testes.
- `docs:` documentação.
- `chore:` manutenção e configuração.
