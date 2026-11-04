# Flow Batch Automator

Automação local para preparar criativos de TikTok Shop e gerar imagens e vídeos
no Google Flow. O painel monta os pedidos; Codex ou Antigravity analisa os
materiais, cria as copys e os prompts; a extensão executa os lotes autorizados.

## Fluxo de uso

1. Copie `.env.example` para `.env` e ajuste `WIN_EXTENSION_DIR` para uma pasta
   existente no Windows, acessível pelo WSL. O exemplo usa `SEU_USUARIO`, que deve
   ser substituído pelo seu perfil do Windows. Inicie com
   `docker compose up -d --build` e carregue a extensão não empacotada dessa pasta
   no Chrome. O caminho real fica somente no `.env` local, ignorado pelo Git.
2. Conecte a extensão e confirme a solicitação em
   <http://127.0.0.1:4319/connect>. Mantenha uma aba autenticada do Flow disponível.
3. Abra <http://127.0.0.1:4319/orders> ou use **Abrir painel de pedidos** na
   extensão, que cria uma nova aba à direita da atual, com o painel lateral
   fechado nessa aba. Ao voltar para uma aba de pedidos já aberta, o painel
   lateral também fecha, mesmo que tenha sido aberto em outra aba. Adicione
   produtos e suas informações. Selecione a foto no campo **Imagem de referência para o Flow**
   e use **Materiais adicionais** para os demais arquivos, de qualquer pasta acessível pelo seletor.
   Os seletores exibem os arquivos escolhidos e acompanham as remoções na lista.
   Distribua formatos/quantidades por produto. O mesmo produto pode
   ter vários formatos. Esta versão não possui presets.
4. Salve e peça no chat: **“Prepare os pedidos 12 e 15”**. A skill
   [flow-orders](skills/flow-orders.md) orienta a preparação. As regras
   criativas estão em [agents/instrucoes.md](agents/instrucoes.md).
5. Confira a prévia publicada, também visível no painel, e autorize no chat o
   conteúdo e o limite de gerações da revisão exata. Salvar/publicar não consome
   créditos. O agente despacha a preparação autorizada.
6. A extensão cria ou recupera o projeto de cada lote e processa a fila, inclusive
   com o painel fechado. O side panel acompanha etapas, pausa, falhas e revisão.

Cada variação gera três vídeos: gancho, Body e CTA. As imagens seguem o formato:

| Formato                             | Imagens novas | Reutilização do frame inicial                                  |
| ----------------------------------- | ------------- | -------------------------------------------------------------- |
| Fábrica, POV + Vendedora e clonagem | 2             | CTA usa a imagem do Body                                       |
| Full POV                            | 1             | Gancho, Body e CTA usam a imagem POV gerada no gancho          |
| Full Vendedora                      | 1             | Gancho, Body e CTA usam a imagem da vendedora gerada no gancho |

Defaults: Nano Banana Pro e Omni 1.1 Flash Frames com frame inicial, 8 segundos,
720p, 9:16. Cada MP4 permanece separado: `01-Gancho.mp4`, `02-Body.mp4` e
`03-CTA.mp4`, juntos por variação. A pasta global existente de downloads do Chrome
não é alterada. Não há montagem de vídeo final. As falas são planejadas
para ocupar perto de 7–7,5 segundos de cada take de 8 segundos, com margem curta
e ritmo natural. Essa é uma estimativa editorial; o áudio gerado exige conferência. A nova regra de imagem única
vale para novas preparações; manifestos já registrados permanecem imutáveis.

Os sete formatos têm bases de copy incorporadas: [Fábrica](agents/copy/fabrica.md),
[POV + Vendedora e Full POV](agents/copy/pov.md) e [Full Vendedora](agents/copy/vendedora.md).
As bases já incorporam os swipes e orientam diretamente sintaxe e progressão
de venda. Para testar uma copy ou formato de referência, use a opção de clonagem
do pedido. As regras incluem fidelidade factual, anti-overlay, apoio físico e
continuidade Body/CTA; não representam validação de conversão ou de mídia real.

## Clonar o formato de um vídeo

No produto do pedido, selecione a foto em **Imagem de referência para o Flow**.
Em **Criação dos vídeos**, escolha **Clonar um vídeo**. Depois importe um único
MP4 baixado do TikTok Shop em **Materiais adicionais**.
Ele será vinculado automaticamente à clonagem, sem
uma segunda seleção. Para clonar outra referência, prepare outro pedido/lote.
**Usar formatos padrão** mostra os sete formatos do catálogo. A quantidade
de variações pode ser definida junto de outros formatos no mesmo produto. A prévia pode ser
reproduzida antes de salvar e consultada novamente no pedido salvo. Use
**Adicionar criação** para combinar os dois caminhos no mesmo produto.
Alternar entre os modos limpa o formato e os materiais adicionais do produto,
incluindo o seletor de arquivos, a lista e as prévias.
Escolha os arquivos novamente no modo ativo. A quantidade de variações e a
imagem de referência do produto são mantidas. Os materiais adicionais são
compartilhados pelas criações do produto.

Salve e peça ao agente que prepare o pedido. O checkout baixa o MP4 verificado
e identifica o vídeo de cada variação. O agente extrai a estrutura narrativa,
a sintaxe frase por frase, o formato, o template e as regras de fidelidade; adapta
as falas e cenas para o produto e publica a análise e as direções de gancho,
Body e CTA para sua conferência. O servidor não chama IA e o vídeo não é
enviado ao Flow; a foto do produto continua como referência de geração. Mesmo com
uma única variação, a copy é criada para o produto a partir da estrutura do vídeo.
Com várias, os argumentos ou ênfases mudam dentro dessa mesma arquitetura;
copiar a transcrição ou trocar apenas palavras não atende à preparação.

A skill [flow-clone-video](skills/flow-clone-video.md) orienta essa análise
e aplica as regras comuns de copy, imagem e animação de `agents/`, preservando
a arquitetura do vídeo escolhido. Ela complementa `flow-orders` em pedidos
mistos. Exemplo de pedido no chat: **“Use $flow-clone-video para preparar os
grupos de clonagem do pedido 12.”**

MP4s podem ter até 64 MB; imagens e documentos continuam limitados a 8 MB.
O modo mantém duas imagens, três vídeos e reutilização exata da imagem de Body
no CTA. A adaptação segue os limites atuais de takes (padrão de 8 s/720p, 9:16),
e não inclui montagem do vídeo de origem. Salvar e publicar não consomem
créditos; a execução depende da autorização da revisão exata no chat.

## Preparação pelo agente

Os comandos são executados na raiz deste repositório, com a API local em execução:

```sh
pnpm orders list
pnpm orders show 12
pnpm orders checkout 12 15
pnpm orders renew .cache/orders/12
pnpm orders publish .cache/orders/12/preparacao.json
```

O checkout reserva cada pedido por 30 minutos e baixa cópias verificadas dos
materiais para `.cache/orders/NUMERO/`, junto com `pedido.json` e o contrato de
preparação. Outro agente não pode reservar o mesmo pedido enquanto essa reserva
estiver válida. Repita checkout para retomar a reserva local; renove durante
trabalhos longos. `FLOW_AGENT_NAME` identifica o agente na reserva.

Preencha os campos criativos mantendo os IDs, formatos e quantidades indicados.
O servidor valida o pedido e compila os templates ativos de animação, dividindo
os lotes automaticamente sem separar o CTA de seu Body. Limites: 30 produtos e
120 variações por pedido; até 30 materiais por produto, imagens/documentos de até 8 MB e MP4 de até 64 MB;
JPEG, PNG, WebP, PDF, TXT, Markdown, JSON e MP4. A referência de geração deve ser imagem.
Os manifestos respeitam os limites existentes de 20 takes e 64 KiB de admissão.

Para revisar antes do despacho:

```sh
pnpm orders checkout 12 --revise
pnpm orders publish .cache/orders/12/preparacao.json
```

A revisão anterior fica registrada; o hash antigo deixa de autorizar a versão
atual. Depois do despacho, alterações exigem novo pedido e autorização.

Somente após autorização explícita no chat para os materiais e o consumo:

```sh
pnpm orders approve 12 --approve --hash HASH_DA_PREPARACAO
```

Com várias extensões autorizadas, acrescente `--client UUID`. “Todos os pendentes”
seleciona os números encontrados no início, sem incluir pedidos criados depois.
A skill pode ser lida por qualquer agente; no Codex, está disponível por referência
no `AGENTS.md`. Não é necessário adicionar provedor de IA ou servidor MCP.

## Armazenamento e limpeza

SQLite guarda pedidos, produtos, configurações, revisões de preparação,
autorizações, fila, tentativas, eventos e checkpoints. Os arquivos importados
ficam separados, em `/data/materials` no mesmo volume persistente local do Compose.
O conteúdo é identificado por SHA-256; importar o mesmo conteúdo reutiliza a cópia.
O navegador envia os arquivos à API local; o agente consulta por identificador e
a extensão recebe somente referências de um despacho autorizado com sua assinatura.
Não há dependência de caminhos Windows, symlinks ou permissões de pasta vinculada.
Credenciais do Google continuam no navegador.

No painel, **Conferir arquivos para limpeza** mostra os materiais elegíveis e o
espaço recuperável. Confirme **Remover estas cópias importadas** para limpar.
Pedidos concluídos ou cancelados permitem remoção; materiais compartilhados com
pedidos ativos, falhos sem revisão ou incertos ficam protegidos. Arquivos sem
pedido podem ser limpos após 24 horas. A limpeza mantém histórico, copys, prompts
e hashes; nova geração pode exigir reimportação. Os originais selecionados e os
MP4s baixados ficam fora dessa limpeza. O checkout do agente usa cache separado
em `.cache/orders`; não é a biblioteca persistente da aplicação.

Pare com `docker compose down`. O volume `flow-batch-automator_sqlite_data` guarda
banco e materiais. Backup deve incluir ambos, com o serviço parado ou uma cópia
consistente do SQLite. Não use `down -v` como parada normal.

## Desenvolvimento

Node.js 24.22.2 LTS (também compatível com Node 26.12.1), TypeScript estrito,
pnpm 12.15.0, Fastify, Zod, `node:sqlite`, Manifest V3 e esbuild. Dependências com
versões exatas. O Compose publica somente em `127.0.0.1:4319`; servidor sem
privilégios e com raiz somente para leitura, exceto o volume de dados.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
pnpm check
pnpm dev
pnpm start
```

- `packages/protocol`: contratos e compilador compartilhado, sem dependência Node de execução.
- `packages/orchestrator`: API local, painel, importação de materiais, SQLite e fila.
- `packages/extension`: identidade, contexto autenticado do Flow, execução e downloads.
- `packages/ui/theme.css`: tema escuro compartilhado pelo painel, conexão e extensão,
  com botões em verde-menta, foco visível e suporte a movimento reduzido. Os builds
  copiam esse arquivo para os respectivos artefatos, sem recursos externos.
- `agents`: instruções criativas versionadas.
- `skills/flow-orders.md`: procedimento de consulta, preparação, revisão e despacho.
- `skills/flow-clone-video.md`: análise e adaptação criativa dos grupos de clonagem.
- `scripts/orders.mjs`: cliente local usado pelo agente.

`MATERIALS_DIR` escolhe o armazenamento no uso fora do Compose; o padrão é
`materials` ao lado do SQLite. `DATABASE_PATH`, `HOST`, `PORT`,
`SQLITE_BUSY_TIMEOUT_MS` e `LOG_LEVEL` configuram o servidor. `.env` é lido pelo
Compose; a execução direta usa as variáveis do processo.

## Validação

```sh
docker compose config --quiet
pnpm test:docker
pnpm test:browser:orders
pnpm test:browser:reuse
pnpm test:browser:formats
pnpm test:browser:queue
pnpm test:browser:navigation
pnpm test:browser:cloning
pnpm test:browser
```

Os testes de navegador usam Chrome for Testing em perfil isolado, referências e
MP4s sintéticos e endpoints HTTPS locais. Não usam perfil pessoal nem consomem
créditos do Google. Exigem navegador de teste instalado; os percursos da porta
padrão precisam de 4319 livre.
`test:browser:formats` valida POV + Vendedora, Full POV e Full Vendedora na
porta 4339, com uma cópia da extensão e dados sintéticos em `.cache/`, sem
interromper a instalação local. `test:browser:cloning` usa servidor e SQLite
isolados na porta 4329, sem precisar parar a instalação local; `test:browser:navigation` usa somente páginas sintéticas.
`test:docker` usa projeto e volume sintéticos próprios e preserva as evidências
em `.cache/`. Esses testes não comprovam qualidade criativa ou uma nova geração
paga na conta real. A autorização de implementação não autoriza essas gerações.

O caminho anterior já teve validação real de Omni Frames e MP4s no Chrome Windows.
O piloto anterior de três takes comprovou o percurso técnico, sem comprovar fala
exata, lip-sync ou aprovação de qualidade criativa. A reutilização do CTA teve
cobertura com fixtures; não atribuir a ela teste pago do piloto anterior.

A integração de RPCs no contexto autenticado da aba é inspirada no
[FlowKit](https://github.com/crisng95/flowkit), referência `19cb87d`. O código
adaptado preserva a [licença MIT e atribuição](packages/extension/public/FlowKit-LICENSE.txt).
As chamadas diretas não atualizam automaticamente a listagem do Flow. Não
recarregue a aba durante uma execução.
