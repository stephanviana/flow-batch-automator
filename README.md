# Flow Batch Automator

Ferramenta local para geração de imagens e vídeos em lote no Google Flow,
com Chrome no Windows e orquestrador no Docker Engine do WSL2.

**Estado: Fase 4 — primeiro take real validado.**
A versão **0.4.3** organiza os takes em lotes, com um projeto do Flow por lote,
e liga a fila ao Flow: referência local → imagem → vídeo → MP4,
com Omni 1.1 Flash em **Frames (somente frame inicial)** como padrão dos novos takes.
O usuário já confirmou a abertura do side panel e a leitura do projeto na própria
sessão do Flow, além da geração completa e do download do MP4 com seus materiais.
Os prompts e a copy são preservados sem alterações. A execução
real exige autorização no formulário para uma imagem e um vídeo com os modelos
selecionados. Nenhuma geração é enviada ao instalar ou recarregar a extensão.

A integração segue a abordagem do [FlowKit](https://github.com/crisng95/flowkit):
RPCs batchexecute na aba autenticada. O usuário retirou as restrições anteriores
contra essa abordagem. A fila, o banco e a autorização local são reaproveitados,
sem dashboard, TTS, novos provedores ou serviços. O importador de lotes dos agentes
continua para a próxima fase; esta entrega oferece a entrada de um take no painel.

## Arquitetura

| Pacote                  | Responsabilidade                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/protocol`     | Contratos Zod, máquina de estados da fila e componentes de assinatura compartilhados com o navegador. |
| `packages/orchestrator` | Fastify, SQLite, autenticação, fila, tentativas, histórico e coordenação sequencial.                  |
| `packages/extension`    | Side panel, referências locais, execução no Flow, download pelo Chrome e simulações de diagnóstico.   |

Node **24.22.2 LTS**, pnpm **12.15.0**, TypeScript **6.0.3**, Fastify **5.12.7**,
Zod **4.6.7** e ws **8.22.0**, com versões exatas e lockfile. A imagem Node está
fixada por digest. Não há Redis, PostgreSQL, dashboard ou serviços externos.

SQLite nativo (`node:sqlite`) usa WAL, foreign keys e busy timeout de 3 segundos.
Migrações e versões são aplicadas transacionalmente. A migração 3 acrescenta as
tabelas da fila sem recriar o banco, as autorizações ou o histórico da Fase 2.
A migração 4 acrescenta checkpoints com os IDs dos resultados de cada etapa.
A migração 5 acrescenta os lotes e seu vínculo com os projetos, mantendo os takes
anteriores, suas entradas e seus projetos originais.
SIGINT/SIGTERM encerram sockets e banco; tarefas cujo envio já foi iniciado passam
a incertas, inclusive na retomada após uma queda abrupta. Pendências não enviadas
permanecem na fila. Use um único orquestrador por volume SQLite.

## Instalação e Docker

Requisitos: Docker Engine e plugin Compose no WSL2, acesso ao daemon, pasta Windows
montada no WSL e Chrome 120+ no Windows. Não é necessário Docker Desktop, Node ou
pnpm no host para construir e executar com Docker. Nenhuma configuração global é
alterada pelos comandos abaixo.

```sh
mkdir -p /mnt/c/Users/stephan/flow-batch-extension
docker compose up -d --build
docker compose ps -a
curl --fail http://127.0.0.1:4319/health
```

Para iniciar novamente, atualizar e parar:

```sh
docker compose up -d          # inicia e copia o build das imagens existentes
docker compose up -d --build  # reconstrói e copia a nova versão
docker compose down          # para preservando o volume SQLite
```

O serviço temporário `sync-extension` deve aparecer como `Exited (0)`. Ele roda
sem rede, com raiz somente para leitura e escrita apenas no destino montado.
O orquestrador aguarda a cópia bem-sucedida para iniciar; não acessa a pasta Windows.
Ele usa UID 1000, raiz somente para leitura, entrada somente para leitura, limites
de recursos e logs com rotação. Publica exclusivamente `127.0.0.1:4319`.

O banco fica no volume `flow-batch-automator_sqlite_data`. **Não use
`docker compose down -v` como parada normal**, pois remove o volume.
Diagnóstico: `docker compose logs --tail=50 sync-extension orchestrator`.

### Extensão no Windows

O destino fixado pelo usuário é **`C:\Users\stephan\flow-batch-extension`**,
equivalente a `/mnt/c/Users/stephan/flow-batch-extension` no WSL. O `.env` local
seleciona esse destino. A instalação anterior foi removida pelo usuário.

`WIN_EXTENSION_DIR` permite configurar o destino do Compose; `INPUT_DIR` configura
a pasta de entrada no host. `.env.example` documenta os padrões. Os bind mounts
devem existir; o Compose não cria pastas ausentes automaticamente. `inputs/` já
acompanha o repositório, mas seus arquivos ainda não são processados nesta fase.

A cópia recusa uma pasta não vazia sem o marcador desta implementação
(`.flow-batch-foundation.json`), evitando sobrescrever outro conteúdo. Os arquivos
são substituídos individualmente e o marcador do build é escrito por último; a
cópia inteira não é uma transação. Recarregue a extensão somente após sucesso.

1. Abra `chrome://extensions` no Chrome do Windows e ative o modo desenvolvedor.
2. Use **Carregar sem compactação** e escolha a pasta acima; se já instalada,
   clique em **Recarregar** depois de cada atualização dos arquivos.
3. A versão atual é **0.4.3**, identificada como **Flow Batch**. Clique no ícone da
   extensão para abrir o painel lateral.

O caminho estável preserva o ID da extensão e seu IndexedDB entre atualizações.
Remover a extensão ou apagar seus dados pode eliminar sua identidade e exigir nova
autorização. O volume SQLite e os dados da extensão são persistências distintas.

## Verificar o projeto no Flow

1. Recarregue a extensão em `chrome://extensions` depois da atualização.
2. Clique no ícone **Flow Batch**; o painel lateral permanece ao lado das abas.
3. Use **Abrir Google Flow**, entre na sua conta e abra um projeto.
4. Clique em **Verificar projeto**. A resposta esperada é **Sessão verificada.
   A leitura do projeto pelo Flow funcionou.**, acompanhada do ID do projeto.

A consulta usa o RPC de leitura `Zzl0ze` em `batchexecute`, adaptado do FlowKit.
Ela não gera mídia, não envia prompts, não resolve reCAPTCHA e não consome créditos.
O token `at`, os metadados de sessão e os cookies são usados apenas dentro da aba.
Se houver mais de um projeto aberto, selecione a aba desejada antes de verificar.
Não é necessário conectar ao orquestrador para testar esta consulta.

Uma consulta bem-sucedida não comprova geração, reCAPTCHA ou download.
A referência é o commit `19cb87d` do FlowKit; APIs privadas podem mudar e erros de
formato são apresentados no painel. A atribuição e a licença estão em
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Um projeto do Flow por lote

Em **Lote e projeto → Novo lote**, informe o nome do produto/campanha/lote.
O padrão **Criar projeto para este lote** cria um projeto com esse nome na conta
conectada ao Flow. **Preparar lote** apenas cria e vincula o projeto; não solicita
imagens, vídeos ou consumo de créditos. A sessão do Flow precisa estar aberta.
A opção **Usar projeto aberto e verificado** vincula o projeto da aba selecionada.

Depois de preparar o lote, adicione seus takes em **Novo take**. Hook, Body, CTA
e outros vídeos do mesmo lote usam o mesmo projeto. Para começar outro lote,
abra **Novo lote** e prepare outro projeto. Para retomar, selecione o lote em
**Lotes registrados** e clique em **Abrir lote**: a extensão reutiliza seu projeto,
inclusive após fechar e reabrir o painel ou reiniciar o servidor. A mesma aba
do Flow é reutilizada: novos lotes voltam à página inicial para criar o projeto
e depois navegam até ele. Abrir um lote navega até seu projeto nessa aba.
Mantenha uma aba do Flow aberta e autenticada; não são abertas abas adicionais.

O nome do lote aparece nos takes da fila. Trocar o lote seleciona o destino dos
próximos takes; os já registrados mantêm seu destino original. A fila continua
única e processa todos os lotes em sequência. Pause a fila e aguarde o take atual
terminar antes de trocar de lote. Entre takes de lotes diferentes, o executor
navega na mesma aba até o projeto vinculado, antes de começar a próxima geração. Não há
recarregamento de página durante um take para atualizar a listagem do Flow.

Uma criação sem resposta confirmada fica pendente de revisão. **Abrir lote**
consulta e recupera o registro existente, sem repetir essa criação. Confira os
projetos no Flow, abra o correto, marque que o conferiu e use **Vincular projeto
aberto**. Se a resposta de criação foi preservada localmente antes de uma falha
na confirmação com o servidor, abrir o lote recupera esse vínculo. Uma falha
comprovada antes do envio permite nova tentativa explícita no mesmo lote.
O projeto de um lote pronto não pode ser trocado; prepare outro lote se precisar
de outro destino.

A migração não atribui lotes artificialmente aos takes antigos: eles preservam
seus projetos e histórico. Os downloads continuam em
`FlowBatch/<id-da-tarefa>/take.mp4`. O importador de JSON da Fase 5 continua
pendente; por enquanto os takes são adicionados pelo formulário.

## Gerar um take e baixar o MP4

1. Recarregue a extensão **0.4.3** em `chrome://extensions` e depois recarregue a
   página do projeto no Flow. A captura da função de verificação precisa iniciar
   junto com a página, como no FlowKit.
2. Abra o painel lateral, confira **Conectada e autenticada** e use **Verificar
   projeto** na aba desejada. A identidade existente é preservada.
3. Em **Lote e projeto**, prepare ou abra um lote. Em **Novo take**, informe
   produto, vídeo e take, escolha uma referência
   JPEG/PNG/WebP de até 8 MB, o formato e os modelos, e cole os dois prompts.
   A copy é opcional e fica no registro do take; não altera os prompts.
4. Confira o projeto e os modelos. Marque a autorização de **uma imagem e um
   vídeo**, consumindo os créditos cobrados pelo Flow, e use **Enfileirar take
   autorizado**. Alterar campos desmarca a autorização. Não há estimativa local
   de preço nem troca automática de modelo em caso de recusa.
5. Use **Processar fila** se ela estiver pausada. Se já estiver habilitada, o take
   começa ao ser enfileirado. Acompanhe referência, imagem, operação de vídeo e
   download no histórico. **Pausar fila** impede o próximo take; o atual continua.
6. A conclusão exige o download confirmado pelo Chrome, com MIME `video/mp4` e
   tamanho maior que zero. O arquivo vai para `FlowBatch/<id-da-tarefa>/take.mp4`
   dentro da pasta de downloads configurada no Chrome. **Mostrar MP4 na pasta**
   localiza o arquivo. O projeto no Flow mantém a imagem e o vídeo gerados.

O pipeline envia uma imagem com a referência e um vídeo a partir dessa imagem,
sem upscale, regeneração, mudança de modelo, reescrita de prompts ou repetição
paga automática. Os modelos de imagem oferecidos são **Nano Banana Pro** e
**Nano Banana 2.1**. O padrão de vídeo é **Omni 1.1 Flash**, **Frames · frame
inicial**, 8 segundos, 720p e vertical 9:16. A imagem gerada pelo Nano Banana é o
frame inicial do vídeo; a referência original continua condicionando a geração
da imagem. Não são enviados frame final ou pedidos de Ingredients/referências.

Com Omni é possível escolher 4, 6, 8 ou 10 segundos e 360p ou 720p. Ao selecionar
Veo, esses controles são ocultados e seus parâmetros próprios são mantidos.
Os modelos Veo existentes continuam disponíveis. Modelos e créditos dependem
da própria conta do Flow; alterar uma opção desmarca a autorização.

O payload de Omni Frames foi reaproveitado de `omni_first_frame_request` do
[FlowKit](https://github.com/crisng95/flowkit/blob/19cb87d6840759f0c0be1739f84ffd6ce59f985a/agent/services/flow_batch.py#L447).
A duração e a resolução ficam vinculadas ao modelo no registro imutável do take
(`abra_i2v_<duração>s`, com sufixo `_360p` para 360p). Não há migração nem alteração
de parâmetros dos takes anteriores. Nano Banana Lite continua legível em registros
históricos, mas não é oferecido para novos takes no painel.

O cartão de andamento no topo acompanha a fila enquanto você rola o painel.
Ao clicar em **Processar fila**, o botão e o cartão mostram **Iniciando fila…**
imediatamente, até a confirmação do comando. Depois, o cartão destaca a etapa:
referência → imagem → vídeo → MP4, com animação e tempo desde a última mudança de
etapa. As informações são consultadas aproximadamente a cada dois segundos, sem
sobrepor consultas ou aplicar respostas antigas por cima das mais recentes.

As marcações representam etapas confirmadas, sem percentual de geração estimado.
**Processando…** indica um take em andamento; **Fila habilitada** indica que a fila
está ligada, mesmo sem pendências. Pausar a fila permite que o take atual termine.
Conclusão fica em verde; falha e resultado incerto são destacados e pedem atenção.
As simulações têm suas próprias três etapas e continuam sem consumir créditos.

As chamadas diretas usadas pela extensão não atualizam a listagem interna da
página do Flow. Isso pode explicar a mídia aparecer somente após recarregar a
página, como observado pelo usuário. Se necessário, recarregue **depois da
conclusão**; a extensão não recarrega automaticamente a aba durante a geração.

A referência original fica no IndexedDB `flow-batch-assets` da extensão; a fila
armazena ID, nome, MIME, tamanho e SHA-256. Os bytes não passam pelo orquestrador.
Remover a extensão ou limpar seus dados pode eliminar as referências; mantenha os
arquivos originais. O limite de 8 MB é por referência. A chave de identidade
continua no banco IndexedDB separado, sem mudança de formato.

Cada take real permite **uma tentativa**. Falha comprovadamente anterior a
qualquer envio encerra a tarefa sem repetição automática. Erro após envio,
resposta incompatível, bloqueio do Flow, timeout ou interrupção deixam o resultado
incerto, pausam a fila e exigem revisão. Não concluir uma tarefa não significa que
nenhum crédito foi consumido. Confira o projeto no Flow e os downloads do Chrome,
registre o que encontrou e use **Encerrar tentativa com falha** para liberar a
barreira. Isso não envia outra geração nem marca um download como concluído.
Uma nova execução exige um novo take e nova autorização.

O upload tem até cinco minutos para confirmar a primeira etapa. Depois, o prazo
máximo da tentativa é de 30 minutos; a busca do vídeo dura até 15 minutos e o
monitoramento do download até três. Sair da conexão interrompe a coordenação e
impede novas etapas, mas uma chamada já enviada ao Flow pode continuar lá.
Checkpoints guardam os IDs já confirmados; não há retomada automática de uma
operação paga nem de um download após resultado incerto.

## Conectar e testar

1. Abra o painel lateral e clique em **Conectar ao Flow Batch**.
2. A extensão abre `/connect` e mostra um código de seis dígitos no painel lateral.
3. Compare o código do painel lateral com o da solicitação na página local. O código vale
   por dois minutos. Clique em **Confirmar conexão** somente se forem iguais.
4. O painel lateral passa a mostrar **Conectada e autenticada**. Nenhuma solicitação é
   aprovada automaticamente; não há código copiado do terminal.
5. Expanda **Testes simulados** e clique em **Enviar teste simulado (5 s)**. O histórico deve passar por enviada,
   em execução e concluída. Isso não interage com páginas nem consome créditos.

**Desconectar** encerra o socket e desativa a reconexão automática, preservando a
autorização e a chave. **Reconectar** retoma uma autorização existente.

Na página `http://127.0.0.1:4319/connect`, é possível cancelar pedidos, consultar
conexões e **Revogar acesso**. Revogação encerra sockets, invalida desafios e faz
a extensão parar as tentativas automáticas. Para autorizar novamente, use
**Conectar ao Flow Batch**, compare o novo código e confirme explicitamente.
Reconectar sozinho não reativa uma autorização revogada.

O heartbeat ocorre aproximadamente a cada 20 segundos. Ausência de respostas
encerra o socket; reconexões usam espera exponencial até cerca de 30 segundos.
Um alarme de 30 segundos recupera o worker quando necessário. Preferências
persistidas preservam desconexão voluntária e revogação entre reinícios.

### Diagnóstico de comunicação da Fase 2

As simulações pertencem à conexão que as recebeu. Uma solicitação HTTP duplicada
com o mesmo `requestId` devolve o registro existente, sem enviar outra execução.
Cada transição é persistida com horário e motivo.

| Estado        | Significado                                                     |
| ------------- | --------------------------------------------------------------- |
| `sent`        | Registro persistido e mensagem enviada à conexão.               |
| `running`     | A extensão confirmou o início do temporizador simulado.         |
| `completed`   | A extensão informou o fim da simulação.                         |
| `interrupted` | Conexão perdida, revogação ou reinício; sem reenvio automático. |

Perder a confirmação de conclusão pode deixar uma simulação interrompida mesmo
que o temporizador tenha terminado. Esta fase não promete execução exatamente uma
vez nem implementa recuperação de gerações pagas. Esse diagnóstico independente
não entra na fila abaixo; use os botões de enfileiramento para testar a Fase 3.

## Fila persistente

No painel lateral conectado, expanda **Testes simulados**, clique em
**Enfileirar Hook, Body e CTA simulados** e depois
em **Processar fila**. Os três takes são executados em ordem, com um trabalho ativo
por vez. **Pausar fila** impede o próximo envio e permite que a tarefa ativa termine.
**Cancelar** está disponível somente para tarefas ainda pendentes.

O processamento é habilitado por identidade e fica persistido: novos itens podem
ser executados enquanto essa identidade mantiver a fila habilitada. Enfileirar
pela primeira vez não inicia o processamento. Uma identidade desconectada não
recebe tarefas; entre identidades conectadas e habilitadas vale a ordem de entrada.

O banco impõe um único registro ativo globalmente por índice único parcial. O
orquestrador persiste a intenção e a tentativa antes de escrever no WebSocket.
Cada evento precisa corresponder à identidade, conexão e tentativa ativas; mensagens
duplicadas ou atrasadas não podem concluir uma tentativa nova. Clientes da Fase 2
sem a capacidade de protocolo 3 continuam podendo diagnosticar a conexão, mas não
recebem tarefas da fila até recarregar a extensão atualizada.

| Estado             | Significado                                                               |
| ------------------ | ------------------------------------------------------------------------- |
| `queued`           | Pendente, ainda não despachada; pode aguardar uma nova tentativa segura.  |
| `dispatching`      | Intenção de envio persistida; aguarda confirmação da extensão.            |
| `submitted`        | Extensão confirmou o envio simulado.                                      |
| `generating`       | Geração em andamento, simulada por temporizador.                          |
| `download_pending` | Etapa de download simulada; nenhum arquivo é baixado.                     |
| `completed`        | Resultado simulado confirmado ou conclusão reconhecida em revisão.        |
| `failed`           | Falha conhecida, com histórico e informação sobre segurança de repetição. |
| `uncertain`        | Resultado desconhecido; exige revisão antes de novos despachos.           |
| `cancelled`        | Cancelada antes do envio.                                                 |

O fluxo de sucesso exige confirmação de todas as etapas; não é possível pular de
pendente ou gerando diretamente para concluída. Resultado simulado contém
`simulated: true` e `outputFile: null`; identificadores de geração começam com
`sim-`. Nenhum MP4, caminho de saída ou download real é inventado.

### Falhas, repetição e recuperação

- **Falha recuperável antes do envio (simulações):** somente uma falha comprovadamente anterior
  a qualquer efeito externo e à confirmação de envio permite repetição automática. A espera é exponencial
  (1 s, 2 s, 4 s...) e o orçamento é de 1 a 5 tentativas por tarefa, padrão 3.
  O item mantém sua posição enquanto aguarda a próxima tentativa.
- **Falha após envio confirmado:** não é repetida automaticamente, mesmo que o
  executor a declare recuperável. Uma nova tentativa manual exige reconhecimento
  explícito de risco de duplicação na API. O painel lateral oferece repetição somente para
  falhas marcadas como seguras e com orçamento restante.
- **Interrupção ou ausência de confirmação:** depois da intenção de envio,
  desconexão, revogação, reinício ou timeout resultam em `uncertain`. O prazo é de
  5 s para confirmar o envio simulado e, após a confirmação, duração simulada mais 10 s. Os prazos do executor real estão descritos acima.
  A conexão expirada é encerrada para interromper seus temporizadores.
- **Barreira de revisão:** qualquer tarefa incerta bloqueia todos os novos
  despachos. A fila da identidade afetada também é pausada. Reconectar, reautorizar
  ou reiniciar não reenviam essa tarefa e não retiram o bloqueio.
- **Revisão explícita:** a API permite registrar sem envio, falha conhecida ou
  conclusão reconhecida, sempre com uma nota. No painel lateral desta fase, **Revisar:
  confirmar sem envio externo** registra a revisão do teste simulado. A tarefa
  passa a falha segura; **Tentar novamente** cria uma tentativa nova, e
  **Processar fila** retoma os envios. Não há repetição direta de `uncertain`.

**Enfileirar falha recuperável** demonstra uma falha antes do envio na primeira
tentativa e sucesso na segunda. **Enfileirar teste de resultado incerto** confirma
o envio e deixa de responder sobre a tarefa, permitindo testar timeout e revisão.
Repetir esse último cenário continua simulando ausência de resposta por definição.

Não há promessa de execução exatamente uma vez: persistir uma intenção não
comprova o efeito externo, e perder a confirmação final não comprova falha. Na
Fase 4, qualquer reconciliação de uma geração real precisará de evidência da fonte
e autorização para consumir créditos novamente.

### Contratos e histórico

Cada tarefa preserva produto, vídeo, formato, take, referências relativas à raiz
`inputs`, prompts e copy originais como strings exatas, estado, tentativas,
horários, identificador da geração e resultado. As referências são metadados;
as simulações não abrem esses arquivos. O executor real usa a referência preservada
no IndexedDB. O importador dos JSONs dos agentes ainda não foi implementado. Caminhos absolutos,
Windows arbitrário e segmentos `..` são recusados nas referências de entrada.

Um lote de até 20 tarefas usa `requestId` e cada tarefa possui `taskKey` UUID.
Reenviar o mesmo pedido ou a mesma chave com o mesmo conteúdo devolve os registros
existentes; conteúdo diferente com a mesma chave resulta em `409`, sem inserir
um lote parcial. Uma nova chave representa um novo item explícito, mesmo com os
mesmos produto e take. O limite HTTP de 64 KiB continua valendo para todo o lote.

As ações usam `requestId`, `taskId` e `expectedRevision`: pedidos repetidos não
reaplicam a ação, e revisões desatualizadas são recusadas. O histórico inclui todas
as tentativas, transições, erros e decisões de revisão. **Ver histórico** mostra
os eventos no painel lateral. O resumo retorna até 50 tarefas, priorizando revisão e trabalho
pendente, com contagens totais; a API de detalhe inclui materiais e tentativas.
Cada identidade acessa apenas suas tarefas. O indicador global de bloqueio não
revela tarefas de outras identidades.

Rotas novas exigem a mesma assinatura e desafio de uso único da Fase 2:

| Rota                      | Corpo / resultado                                           |
| ------------------------- | ----------------------------------------------------------- |
| `GET /api/queue`          | Estado, bloqueio, contagens e até 50 tarefas da identidade. |
| `POST /api/queue`         | `{requestId, tasks: [...]}`; enfileira atomicamente.        |
| `POST /api/queue/control` | `{action: "start" ou "pause"}`.                             |
| `POST /api/queue/task`    | `{taskId}`; materiais originais, tentativas e eventos.      |
| `POST /api/queue/actions` | Ação `cancel`, `retry` ou `resolve`, com ID e revisão.      |

Os contratos Zod em `packages/protocol/src/queue.ts` são a referência dos campos.
`executor` aceita `simulation` e `google-flow`. Nas simulações, os cenários são `success`,
`transient_before_submit`, `permanent_before_submit`, `failure_after_submit` e
`stall_after_submit`. Não existe executor Google Flow nesta versão.

## Perfil de segurança

A extensão gera ECDSA P-256 via WebCrypto com chave privada não exportável e guarda
o par em IndexedDB. Somente o JWK público é enviado ao servidor. A autorização
SQLite identifica a combinação da chave pública e do ID da extensão.

Os desafios duram 60 segundos, contêm nonce aleatório de 256 bits e são consumidos
por `DELETE ... RETURNING` síncrono antes da verificação assíncrona. Mesmo uma
assinatura inválida consome o desafio. A autorização é conferida novamente após
a verificação, impedindo aceitar uma revogação ocorrida durante essa operação.

O perfil `flow-batch-signature-v1` assina os bytes UTF-8 deste array JSON ordenado:

```text
[version, clientId, challengeId, nonce, method, authority, target, bodyDigest]
```

`bodyDigest` é SHA-256 hexadecimal dos bytes exatos do corpo HTTP recebido;
`target` é o caminho exato da requisição, sem normalização. Alterar método,
autoridade, caminho ou até whitespace do corpo invalida a prova. Assinaturas
ECDSA/SHA-256 usam IEEE P1363 (64 bytes), codificadas em base64url sem padding.
O perfil cobre componentes inspirados na RFC 9421, mas **não implementa seu formato
de cabeçalhos nem oferece interoperabilidade com implementações genéricas dela**.
Não há bearer, fallback de autenticação ou segredo na URL.

Nas rotas HTTP, `X-Flow-Extension` identifica a extensão quando fetch privilegiado
omite Origin. Esse ID não autentica a chamada: a assinatura continua obrigatória.
Quando Origin está presente, deve ser exatamente a origem desse ID. No WebSocket,
Origin é obrigatória e a prova da primeira mensagem deve pertencer à mesma extensão.
O prazo para autenticar o socket é de 5 segundos; query strings em `/ws` são recusadas.

A gestão usa cookie HttpOnly, SameSite=Strict, sessão em memória com duração de
30 minutos, Host permitido, Origin exata em mutações e `X-Flow-Management: 1`.
Não há CORS amplo ou framing. Sessões de gestão deixam de valer após reiniciar o
servidor; reabrir `/connect` cria uma nova sessão, sem aprovar conexões.

O transporte é HTTP/WS em loopback, sem TLS. O perfil não protege contra um sistema
operacional comprometido, código malicioso na própria extensão ou processos locais
com acesso aos dados do usuário. Uma chave não exportável não impede que código
comprometido no mesmo contexto a use para assinar. Não exponha o serviço na rede.

A extensão pede `storage`, `alarms`, `sidePanel`, `scripting`, `downloads` e acesso
a `127.0.0.1`, `flow.google.com`, `labs.google` (páginas Flow) e `flow-content.google`. Match patterns não
restringem portas; a CSP limita o HTTP/WS da extensão à porta 4319. As chamadas ao
Flow são feitas na própria aba, em MAIN world, com sua sessão. Não há permissão de
cookies ou debugger. `downloads` permite iniciar e confirmar o download pelo Chrome. O token de página e os dados brutos
do projeto não saem da aba; a UI recebe somente resultado, ID do projeto e horário.
O token reCAPTCHA é obtido e aplicado ao contexto da chamada dentro da aba.
A captura antecipada usa `flowkit-hijack.js` (MIT); não há serviço externo de
resolução nem cópia dos scripts proprietários do Google. URLs assinadas de mídia
permanecem no navegador, sem gravação no orquestrador, logs ou UI.
Só clientes de protocolo v4 recebem `flow-execute`; clientes v3 continuam
recebendo apenas simulações até a extensão ser recarregada.
O worker aceita comandos da URL exata do side panel, sem ponte de mensagens
controlada pela página ou proxy genérico para URLs arbitrárias.

## Healthchecks e API

| Rota                        | Proteção / resultado                                                            |
| --------------------------- | ------------------------------------------------------------------------------- |
| `GET /health/live`          | Público; processo HTTP ativo.                                                   |
| `GET /health`               | Público; consulta real ao schema SQLite, `200` ou `503`, sem caminhos internos. |
| `POST /api/pairing`         | ID da extensão e JWK público; cria pedido, nunca aprova.                        |
| `POST /api/challenges`      | Só emite para identidade autorizada e não revogada.                             |
| `GET /api/identity`         | Assinatura e desafio de uso único.                                              |
| `GET/POST /api/simulations` | Assinatura; lista somente registros da identidade ou envia uma simulação.       |
| `GET /ws`                   | Upgrade com Origin exata; autenticação na primeira mensagem.                    |
| `/manage/*`                 | Sessão e cabeçalho de gestão; mutações também exigem Origin exata.              |

Há limites de payload de 64 KiB, 20 pedidos pendentes globais, 16 desafios por
identidade e 16 sockets simultâneos. O healthcheck Docker usa `/health` a cada
20 segundos. Prontidão comprova leitura do banco, não ações no Flow ou futuras escritas.

## Desenvolvimento e testes

Use Node 24.22.2 e pnpm 12.15.0 já disponíveis no ambiente, sem instalar ferramentas
globais automaticamente. A linha Node 26.12.1+ também é aceita para desenvolvimento.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm build
pnpm start
```

`dev` recompila e reinicia o servidor. Mudanças em `protocol` exigem recompilar
esse pacote; arquivos da página local são copiados no build. Para testar uma
extensão local sem Docker, carregue `packages/extension/dist` após o build.

| Variável                 | Padrão local               | Container                 |
| ------------------------ | -------------------------- | ------------------------- |
| `HOST`                   | `127.0.0.1`                | `0.0.0.0`                 |
| `PORT`                   | `4319`                     | `4319`                    |
| `DATABASE_PATH`          | `./data/flow-batch.sqlite` | `/data/flow-batch.sqlite` |
| `INPUT_DIR`              | `./inputs`                 | `/inputs`                 |
| `SQLITE_BUSY_TIMEOUT_MS` | `3000`                     | `3000`                    |
| `LOG_LEVEL`              | `info`                     | `info`                    |

O servidor lê o ambiente do processo; `.env` é interpolado pelo Compose. Caminhos
locais são relativos ao diretório de execução. `INPUT_DIR` do Compose define o
bind mount; o caminho interno continua `/inputs`. A extensão usa porta fixa 4319.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm check
docker compose config --quiet
pnpm test:docker
```

Testes locais usam SQLite real, chaves efêmeras de teste, Fastify inject e clientes
WebSocket reais em loopback. Cobrem expiração, aprovação, revogação, replay
concorrente, adulteração de bytes, interrupção, migração da Fase 2, fila sequencial,
orçamento de tentativas, deduplicação e barreira global de revisão. Não comprovam Chrome.

`test:docker` exige daemon e porta 4319 livre. Usa projeto e volume novos, verifica
build, cópia, isolamento e persistência após `down`/`up`. Para os containers ao terminar
e preserva seu volume sintético. Os logs ficam em `.cache/`.

### Extensão real no Chrome for Testing

O Playwright é dependência de desenvolvimento, sem papel operacional. O teste usa
somente um banco e um perfil novos em `.cache/`; nunca o perfil pessoal.
Pare o orquestrador para liberar a porta antes de executar:

```sh
docker compose stop orchestrator
PLAYWRIGHT_BROWSERS_PATH=.cache/browsers pnpm exec playwright install chromium
pnpm build
pnpm test:browser
docker compose up -d
```

O teste compara códigos, confirma pela página real, verifica que a chave privada
não pode ser exportada e sobrevive ao reinício do navegador, executa simulações,
testa heartbeat com painel lateral fechado, reinicia servidor e navegador, verifica ausência
de reenvio e testa revogação e reautorização explícita. Também processa três takes
pela fila real, verifica histórico e repetição segura, reinicia o servidor durante
um trabalho e exige revisão antes de uma nova tentativa. `pnpm test:browser:queue`
omite os cenários longos de recuperação da Fase 2, com o mesmo isolamento.
Ambos também conferem a configuração de side panel e executam a consulta de
projeto em MAIN world contra páginas HTTPS interceptadas: sem sessão pronta,
sucesso, erro de RPC, resposta incompatível e HTTP 403. Verificam que o token não
aparece na resposta ao painel nem no storage. Essas fixtures não comprovam acesso
à conta real do Flow nem geração de mídia. A abertura nativa do painel pela barra
do Chrome e a consulta na conta do usuário exigem conferência no Windows.
`pnpm test:browser:flow` executa somente pareamento, consulta e os cenários do
executor real contra fixtures locais. O teste serve um MP4 sintético por HTTPS
local, usa resolução de hosts e confiança por SPKI apenas no perfil isolado,
restaura o comportamento nativo de downloads desse perfil e confere caminho e
bytes do arquivo. Não instala certificados, não muda o Chrome pessoal e não chama
a geração real do Google. Requer OpenSSL para o certificado temporário.
Também verifica falha de reCAPTCHA, interrupção durante imagem sem envio posterior
de vídeo e rejeição de HTML como MP4. Os três comandos de navegador incluem essa
validação do executor. Os arquivos de referência e vídeo de teste são sintéticos.
Logs e screenshots ficam
em `.cache/`. O teste requer bibliotecas Linux compatíveis com o navegador; não
instala pacotes do sistema automaticamente.

Chrome for Testing no Linux e o Chrome do usuário no Windows são ambientes distintos.
Após atualizar a extensão no Windows, valide manualmente conexão, simulação,
desconexão/reconexão e revogação seguindo as instruções acima. O acesso Windows
ao serviço pode ser conferido no PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:4319/health
```

Na Fase 2 passaram 23 testes no Node LTS, integração Docker e Chrome for Testing.
O usuário confirmou no Chrome do Windows: **“Conectou e concluiu a simulação”**,
após recarregar a extensão, comparar os códigos e confirmar a conexão na página
local. Reconexão, reinícios, revogação e reautorização foram validados no Chrome
for Testing no Linux. A conferência da fila 0.3.0 no Chrome do Windows foi realizada
separadamente, conforme o registro abaixo.

Na entrega 0.3.0 passaram `pnpm check`, 37 testes no Node 24.22.2 LTS e a regressão
completa da extensão no Chrome for Testing 156/Linux. O teste Docker confirmou
persistência após `down`/`up`: intenção de envio como incerta, tarefa não enviada
como pendente, materiais originais preservados e processamento pausado. No volume
existente, a migração 3 manteve a autorização cadastrada; pelo PowerShell foram
conferidos o manifest 0.3.0 e o healthcheck. O usuário confirmou no Chrome do
Windows: **“Os três takes concluíram e o histórico abriu”**, após recarregar a
extensão, enfileirar Hook, Body e CTA simulados e processar a fila. Isso confirma
execução sequencial e abertura do histórico nesse navegador. Falhas, repetição,
reinício e revisão de resultados incertos foram validados automaticamente no Linux;
não houve confirmação manual desses cenários no Windows.

Na entrega 0.3.1 passaram `pnpm check` (37 testes) e a regressão completa no Chrome
for Testing 156/Linux, incluindo o adaptador de consulta com respostas
interceptadas. O build Docker com Node 24.22.2 foi implantado, `sync-extension`
terminou com código 0 e o orquestrador ficou saudável. O volume existente manteve
as migrações 1–3, uma autorização e os três takes concluídos. Pelo PowerShell foram
conferidos a versão 0.3.1, o `sidepanel.html`, as novas permissões e o healthcheck.
O usuário confirmou no Chrome do Windows: **“O painel abriu e a sessão foi
verificada”**, após recarregar a extensão, abrir um projeto na própria conta do
Flow e usar **Verificar projeto**. Isso confirma a abertura nativa do side panel e
a leitura do projeto pelo adaptador nessa sessão. Geração de imagem/vídeo,
reCAPTCHA e download ainda não foram validados. Nenhuma geração paga foi executada.

Na entrega 0.4.0 passaram `pnpm check` (45 testes), os mesmos testes no Node
24.22.2 LTS e a integração Docker em projeto/volume sintéticos. A regressão da fila
no Chrome for Testing passou; `pnpm test:browser:flow` confirmou o executor contra
fixtures HTTPS locais: referência e prompts exatos, autorização, tokens de
verificação novos e restritos à aba, imagem/vídeo únicos, associação entre operação
e mídia, download real pelo Chrome no caminho esperado e comparação dos bytes do
MP4. Também confirmou interrupção sem envio da etapa seguinte, falha de
verificação antes do upload e rejeição de HTML como vídeo. Testes específicos
cobrem a notificação de conclusão durante uma consulta de download em andamento
e a recusa de WebM, arquivo ausente e host diferente do Flow.

O Docker 0.4.0 está implantado e saudável. A migração 4 manteve a autorização e os
três takes concluídos do volume existente. O PowerShell confirmou a versão, as
permissões, o script de captura e o healthcheck; os arquivos no destino Windows
conferem com o build local. As fixtures não comprovam, por si só, a geração nem o
reCAPTCHA reais do Google.

O usuário confirmou no Chrome do Windows: **“Concluiu e baixou o MP4”**, após o
teste com sua referência e seus prompts no projeto real do Flow. A conferência
somente de estados no SQLite confirmou uma tarefa `google-flow` concluída em uma
tentativa, resultado real e os cinco checkpoints: referência enviada, imagem
gerada, vídeo solicitado, vídeo localizado e download iniciado. A fila contém os
três takes simulados anteriores e esse take real, todos concluídos; o serviço
permanece saudável. A Fase 4 está validada para esse percurso. Novos takes mantêm
a autorização explícita no formulário; o importador de lotes segue para a Fase 5.

Na entrega 0.4.1, os 48 testes de `pnpm check` passaram. Os 11 testes de protocolo
e extensão também passaram no Node 24.22.2 LTS. No Chrome for Testing, o pipeline
com fixtures confirmou Omni Frames em 8 s/720p e 4 s/360p, as duas opções Nano
Banana, a imagem gerada como frame inicial, os parâmetros de duração/resolução e
o download do MP4. A seleção de Veo oculta e desabilita os controles exclusivos
de Omni. Os testes de payload cobrem todas as combinações 4/6/8/10 s, 360p/720p e
9:16/16:9, além da compatibilidade com registros e payloads Veo existentes.
Nenhuma geração paga foi enviada pelo agente durante esse ajuste.

A versão 0.4.1 está implantada e saudável, com os arquivos conferidos no destino
Windows e o manifest/healthcheck verificados pelo PowerShell. Os quatro takes
concluídos foram preservados, incluindo o take real com seu modelo Veo original;
as migrações continuam em 1–4. A preferência por Omni afeta somente novos takes.

O usuário confirmou na conta real do Flow, no Chrome do Windows: **“Gerei com Omni
e baixou o MP4”**. A consulta somente de metadados no SQLite confirmou o take
`abra_i2v_8s` (Omni 1.1 Flash, Frames com frame inicial, 8 s/720p) concluído em uma
tentativa, com resultado real e os cinco checkpoints. O take Veo anterior também
permanece concluído, e o serviço está saudável. A validação real de Omni se aplica
a esse percurso; as demais durações e a resolução 360p continuam verificadas por
testes com fixtures. Novos takes seguem exigindo autorização no formulário.

Na entrega 0.4.2, `pnpm check` passou com 53 testes, e os dez testes da extensão
passaram também no Node 24.22.2 LTS. A validação no Chrome for Testing confirmou a
mensagem imediata de início mesmo com confirmação atrasada do comando, os estados
de processamento, conclusão das simulações e revisão após interrupção. O pipeline
com fixtures confirmou as etapas de imagem e vídeo e o indicador de download
antes da liberação do arquivo pelo servidor HTTPS local; só depois o cartão ficou
verde, com as quatro etapas concluídas. Nenhuma geração paga foi executada para
validar essa mudança de interface.
A versão 0.4.2 está implantada e saudável. O PowerShell confirmou o manifest e o
healthcheck, os oito arquivos do build conferem no destino Windows e os cinco
takes concluídos foram preservados, sem nova migração de banco. Recarregue a
extensão com a fila ociosa para aplicar a nova interface.

Na entrega 0.4.3, `pnpm check` passou com 60 testes. A suíte de 60 testes também
passou no Node 24.22.2 LTS em container isolado. A conferência no Chrome for Testing
(`pnpm test:browser:queue`) cobriu projetos distintos para lotes, vínculo de projeto
existente, reutilização da mesma aba, retomada após recarregar o painel, recuperação
de confirmação local perdida e revisão após criação incerta e reinício do servidor.
A fila voltou ao projeto gravado no take na mesma aba antes de gerar e confirmou
o download do MP4 sintético. Não houve chamada ao Google real nem consumo de créditos.
Após testar o novo fluxo na conta real do Flow no Chrome do Windows, o usuário
confirmou: **“Testei o novo fluxo e está funcionando corretamente.”** A divisão
por projetos está validada pelo usuário. Os cenários de interrupção e recuperação
descritos acima continuam tendo evidência específica em testes com fixtures.
A versão 0.4.3 está implantada e saudável: migrações 1–5 aplicadas, cinco takes
anteriores concluídos e sem lote atribuído artificialmente. O PowerShell confirmou
o manifest 0.4.3 e o healthcheck; os oito arquivos do destino Windows conferem
com o build local. Recarregue a extensão com a fila ociosa antes de usar os lotes.

Referências: [WebCrypto](https://www.w3.org/TR/WebCryptoAPI/),
[componentes de assinaturas HTTP](https://www.rfc-editor.org/rfc/rfc9421.html),
[WebSocket em service workers](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets),
[ciclo de vida de workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
[ordem de inicialização do Compose](https://docs.docker.com/compose/how-tos/startup-order/),
[Chrome Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
e [execução de scripts no navegador](https://developer.chrome.com/docs/extensions/reference/api/scripting).
