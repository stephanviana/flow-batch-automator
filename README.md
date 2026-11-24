# Flow Batch Automator

Ferramenta local para preparar pedidos de TikTok Shop e gerar imagens e vídeos
no Google Flow. O painel organiza produtos, materiais, formatos e quantidades;
o agente conectado pelo MCP cria copy e prompts a partir das instruções locais;
a extensão executa os grupos autorizados.

## Instalação pelo Docker Compose

O modo suportado de execução é Docker Compose a partir deste repositório.
A distribuição desktop é uma direção futura. O servidor, a fila e a extensão
continuam separados para preservar suas responsabilidades.

Requisitos: Docker com Compose, Chrome 120+ e Node.js 24.22.2 LTS (ou 26.12.1)
para o conector MCP. Os comandos de desenvolvimento e manutenção usam
pnpm 12.15.0 e o lockfile do projeto. No Windows, execute o Compose pelo
Linux/WSL com Docker disponível; carregue a extensão no Chrome do Windows.

Na primeira configuração, prepare as instruções e uma pasta para a extensão:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm library seed /CAMINHO/Minha-Biblioteca-Flow
pnpm library validate /CAMINHO/Minha-Biblioteca-Flow
mkdir -p /CAMINHO/flow-batch-extension
```

`library seed` copia a edição versionada de `instrucoes/` somente para uma pasta
nova ou um scaffold modular vazio sem capturas. Conteúdo próprio, bibliotecas
incompletas/legadas e formatos removidos são preservados. `library init` continua
criando apenas o scaffold vazio. Esses comandos não criam backups nem geram mídia.

Crie `.env` a partir de `.env.example` somente se ele ainda não existir.
Configure `WIN_EXTENSION_DIR` com a pasta existente da extensão e
`FLOW_LIBRARY_DIR` com a biblioteca ativa. Ambos são caminhos absolutos do
ambiente que executa Compose. No WSL, use o caminho Linux para a pasta Windows.
A pasta da extensão deve estar vazia ou identificada como Flow Batch.

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 orchestrator
```

O build usa Node e pnpm com versões fixadas, instala as dependências do lockfile
e prepara a árvore de produção dentro da imagem Linux. Não copia `node_modules`
do host. `sync-extension` atualiza os arquivos gerenciados da extensão no destino
configurado a cada início. Ele não tem rede e só escreve nessa pasta.

Abra `chrome://extensions`, ative o modo do desenvolvedor e carregue sem
compactação a pasta da extensão. Confirme a identidade em
<http://127.0.0.1:4319/connect> e abra <http://127.0.0.1:4319/orders>.
Entre no Google Flow nessa conta e mantenha a sessão disponível.
O registro do conector MCP está descrito adiante e permanece independente do
contêiner. Instalar ou atualizar não autoriza gerações pagas.

O servidor roda sem privilégios, com raiz somente para leitura e publicação
apenas em `127.0.0.1:4319`. O Compose monta a biblioteca em `/library`; SQLite
e materiais ficam no volume persistente `sqlite_data` do projeto. No projeto
padrão, seu nome é `flow-batch-automator_sqlite_data`. Confira o nome real antes
de operar uma instalação existente.

Para atualizar, obtenha a revisão desejada do repositório e execute
`docker compose up -d --build`; depois recarregue a extensão e os clientes MCP.
As instruções ativas não são sincronizadas automaticamente com o código.
Para parar preservando dados:

```sh
docker compose down
```

Antes de adotar outra instalação, confira processos, porta, projeto, volumes
e pastas existentes. Nenhum comando migra ou apaga dados de instalações
anteriores automaticamente. Não use `docker compose down -v` como parada.
Para remover a interface, pare o Compose, remova a extensão no Chrome e apenas
a entrada `flow-batch` nos clientes MCP. Biblioteca, materiais, capturas,
volumes e downloads exigem uma decisão separada para exclusão.

### Variáveis de ambiente

| Variável                 | Uso e padrão                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `WIN_EXTENSION_DIR`      | Compose: pasta existente da extensão, obrigatória.                                         |
| `FLOW_LIBRARY_DIR`       | Compose: biblioteca ativa, obrigatória; também é aceita pela CLI offline quando exportada. |
| `FLOW_API_URL`           | MCP e CLI de pedidos: `http://127.0.0.1:4319`.                                             |
| `FLOW_AGENT_WORKSPACE`   | Workspace MCP: `~/.flow-batch/pedidos`.                                                    |
| `FLOW_AGENT_NAME`        | Agente da CLI orders: `agente-local`.                                                      |
| `CODEX_HOME`             | Pasta do Codex: `~/.codex`; `--config` no instalador MCP tem precedência.                  |
| `LOG_LEVEL`              | Logs: `info`; aceita `silent`, `fatal`, `error`, `warn`, `info` e `debug`.                 |
| `HOST` / `PORT`          | Internos ao servidor: Compose usa `0.0.0.0` / `4319`.                                      |
| `DATABASE_PATH`          | Interno ao servidor: Compose usa `/data/flow-batch.sqlite`.                                |
| `MATERIALS_DIR`          | Materiais: por padrão `materials` junto ao SQLite.                                         |
| `LIBRARY_DIR`            | Interno ao servidor: Compose usa `/library`; a CLI offline também aceita a variável.       |
| `SQLITE_BUSY_TIMEOUT_MS` | Espera SQLite: 3000 ms, de 100 a 10000.                                                    |

Compose lê `.env` para interpolação; as CLIs no host usam apenas as variáveis
exportadas ou os argumentos explícitos. A extensão aponta para a porta 4319.
`PLAYWRIGHT_BROWSERS_PATH` escolhe o navegador somente nos testes.

## Instruções locais

A edição criativa versionada está em `instrucoes/`: `base.md` e oito arquivos
em `formatos/`. Use `pnpm library seed PASTA` para iniciar uma biblioteca
externa. O runtime lê exclusivamente a pasta ativa configurada por `LIBRARY_DIR`
(Compose: `FLOW_LIBRARY_DIR`), sem buscar regras faltantes no checkout.
Atualizar o software não repõe arquivos removidos nem sincroniza edições locais.
Compare manualmente as edições quando quiser incorporar mudanças.

| Arquivo em `formatos/` | Formato                   |
| ---------------------- | ------------------------- |
| `factory.md`           | Fábrica Padrão            |
| `factory-group.md`     | Fábrica Grupo             |
| `factory-truck.md`     | Fábrica + Caminhão        |
| `factory-inclined.md`  | Fábrica Esteira Inclinada |
| `pov.md`               | POV + Vendedora           |
| `full-pov.md`          | Full POV                  |
| `seller.md`            | Full Vendedora            |
| `clone.md`             | Clonagem                  |

A seção `[copy]` de `base.md` contém o playbook de criação das falas novas.
Ele define o diagnóstico do produto, a cadência, a alternância das aberturas e
os limites de 20 a 26 palavras e 130 a 165 caracteres por take de 8 segundos.
Em POV + Vendedora, use POV no gancho e Vendedora no Body e no CTA. Na clonagem,
`adapt-format` aplica o playbook à estrutura do vídeo analisado, e
`preserve-copy` mantém a transcrição conferida.

A seção `[animation]` orienta movimentos conforme o comportamento comprovado do
material, com apoio e contato estáveis e continuidade da forma e dos detalhes.
Na clonagem, simplifique gestos complexos preservando a intenção demonstrativa
da referência; registre a adaptação na análise e mantenha a fala de
`preserve-copy` intacta. A regra vale para qualquer produto, sem proibir
deformações naturais necessárias ao uso. Bibliotecas ativas existentes precisam
receber essa edição explicitamente; atualizar o software não as sincroniza.

`base.md` começa com `<!-- flow-base:1 -->`. Use `# [common]`, `# [copy]`,
`# [image]` e `# [animation]`, com títulos livres após os identificadores.
Preencha ao menos uma seção editorial e os formatos usados no pedido.
`[animation]` contém os templates reconhecidos: cabeçalhos iniciados por
`## Fábrica — `, `## Esteira inclinada — `, `## Vendedora — `, `## POV — ` e
`## Clonagem — `, com o espaço após o travessão. Cada template usa um bloco
cercado de crases com linguagem `text`, inclui `{{fala}}` e pode usar
`{{direcao}}`/`{{duracao_segundos}}`. A última linha não vazia começa com
`Visual exclusions:`. Placeholders não resolvidos e `[INSERIR` são recusados.

O checkout entrega a base e apenas os formatos solicitados, sem rotas editáveis.
Cada arquivo modular admite até 1 MiB; o conjunto admite até 8 MiB. Links
simbólicos, mistura de layouts e formatos desconhecidos são recusados.
`library validate` confere o catálogo completo; reservar exige os formatos
selecionados. Uma biblioteca incompleta não impede abrir o painel.

A identidade e revisão atual ficam em `instrucoes.json`; `.historico/` contém
as capturas imutáveis das reservas. São dados operacionais, não cache. O nome
antigo `biblioteca.json` é migrado por renomeação, sem reescrever bytes nem criar
backup. Se ambos existirem com identidades ou revisões diferentes, a abertura é
recusada. Uma duplicata equivalente perde só o nome legado. Preserve esses dados
junto da biblioteca ativa; não os versione com os textos criativos.

Layouts existentes em `biblioteca.md` e `instrucoes/` com rotas antigas continuam
legíveis, inclusive em capturas. Para visualizar a divisão sem criar metadados,
diretórios ou arquivos:

```sh
pnpm library split [PASTA]
```

`library split [PASTA] --preserve-originals` aplica a divisão e arquiva fontes
em `.rascunhos/`. Autorize explicitamente esse backup antes de executá-lo.
Não há conversão automática de bibliotecas existentes. `library convert`
continua reunindo arquivos em `biblioteca.md`; import/export Markdown e JSON e
restore continuam disponíveis. Importação, conversão e restauração podem
arquivar conteúdo substituído e também exigem autorização para esse backup.
Um `base.md` isolado não é um documento completo para `library import`.

`pnpm library init [PASTA]` cria somente os nove arquivos vazios da estrutura
modular. Os demais comandos funcionam por `pnpm library` após o build.
Sem pasta explícita, usam `FLOW_LIBRARY_DIR`, depois `LIBRARY_DIR` e, na ausência
de ambas, `~/.flow-batch/biblioteca`. As variáveis precisam estar exportadas;
para usar o mesmo destino do `.env` do Compose, informe a pasta explicitamente.

Leitura/salvamento MCP sem `path` resolve o arquivo principal do layout ativo:
`base.md`, `biblioteca.md` ou as rotas legadas. Informe `revision` para ler uma
captura. CLI e MCP usam `flow-orders/5`; atualize e reabra o conector junto do
servidor. Isso é distinto da versão da conexão da extensão. Edições só afetam novas
reservas; capturas, materiais e preparações anteriores permanecem intactos.
A base pode servir a futuros canais; novos canais e formatos exigem suporte
no contrato e no motor. Não há módulo orgânico/DTC/ODR implementado.

## Backup e mudança de computador

```sh
pnpm library export /CAMINHO/Biblioteca-Flow /CAMINHO/biblioteca.md
# Na outra máquina, com o checkout compilado:
pnpm library import /CAMINHO/Biblioteca-Flow /CAMINHO/biblioteca.md
# Backup completo com histórico, somente quando autorizado:
pnpm library export /CAMINHO/Biblioteca-Flow /CAMINHO/backup-instrucoes.json
```

O Markdown transporta as instruções atuais em um arquivo. O JSON inclui os arquivos atuais e as capturas
históricas da biblioteca. A pasta inteira também pode ser copiada ou versionada
em um repositório privado próprio. Restaurações e importações preservam arquivos
substituídos em `.rascunhos/`. Esse armazenamento de recuperação não integra o
backup JSON. Pedidos, materiais e vídeos exigem backup próprio da operação.

A cada nova reserva, os arquivos são validados e capturados automaticamente.
Edições locais afetam as próximas reservas; as anteriores usam seus arquivos
capturados. Não existe publicação manual de instruções pelo painel. Novos swipes
podem ser fornecidos ao agente como referências para editar as instruções, sem
passar a fazer parte do pacote ou de cada geração.

## Conectar o MCP

Após iniciar o servidor, configure o Antigravity com um único comando:

```sh
pnpm mcp:install
pnpm mcp:install codex
```

O instalador copia o conector independente para `~/.flow-batch/mcp/`, registra
`flow-batch` em `~/.gemini/config/mcp_config.json` e configura o Node e os caminhos
absolutos do ambiente atual. Ele preserva outros servidores, variáveis e ajustes
existentes, cria backups antes de alterar arquivos e consulta o servidor sem
preparar ou despachar pedidos. Executar novamente atualiza a instalação; sem
alterações, não reescreve os arquivos nem cria backups adicionais.

Execute o instalador no mesmo ambiente do Antigravity: no WSL para o CLI do WSL,
ou no Windows para um cliente Windows. Depois recarregue os servidores em `/mcp`
ou reabra o cliente. O instalador não encerra suas conversas.

Para escolher caminhos ou porta:

```sh
pnpm mcp:install --workspace /CAMINHO/Trabalhos-Flow --server http://127.0.0.1:4319
```

`codex` registra em `~/.codex/config.toml` (ou em `CODEX_HOME`), na tabela
`mcp_servers.flow-batch`. O instalador usa um parser TOML e preserva os valores
das demais configurações, com backup do texto original antes de reserializar.
`--config ARQUIVO` escolhe outro arquivo do cliente selecionado;
`--directory PASTA` escolhe onde guardar o conector. Os backups ficam em
`.flow-batch-backups/` junto aos arquivos alterados. JSON/TOML inválido, conflitos de
entradas e links simbólicos são recusados, preservando os arquivos existentes.
Se o servidor estiver parado, a configuração é instalada e o resultado informa
que será necessário iniciá-lo antes de preparar pedidos. `--skip-check` dispensa
a consulta ao servidor.

Também é possível instalar a partir do arquivo baixado, fora do repositório.
O conector inclui suas dependências e exige Node.js 24.22.2 LTS ou 26.12.1:

```sh
curl --fail http://127.0.0.1:4319/agent/flow-batch-mcp.mjs -o /CAMINHO/flow-batch-mcp.mjs
node /CAMINHO/flow-batch-mcp.mjs --install antigravity
```

Exemplo para clientes que usam `mcpServers`:

```json
{
  "mcpServers": {
    "flow-batch": {
      "command": "node",
      "args": ["/CAMINHO/flow-batch-mcp.mjs"],
      "env": {
        "FLOW_API_URL": "http://127.0.0.1:4319",
        "FLOW_AGENT_WORKSPACE": "/CAMINHO/Trabalhos-Flow"
      }
    }
  }
}
```

Use caminhos absolutos do sistema que executa o conector. Se o agente roda no
WSL, use o Node e o caminho Linux diretamente. Acrescente a entrada ao mapa
`mcpServers` existente sem criar outra camada dentro dele; depois recarregue o
cliente MCP. No Windows, escape as barras dos caminhos no JSON.

`FLOW_AGENT_WORKSPACE` é opcional; o padrão é `~/.flow-batch/pedidos`. Abra a
conversa de produção nessa pasta, fora do código da aplicação. Não é necessário
instalar skills globais. `pnpm mcp` também inicia o conector dentro do projeto.
A análise de PDF e MP4 depende das capacidades do agente; o servidor não chama IA.
Credenciais e tokens do Google permanecem no navegador.

## Pedidos e execução

O editor mostra as informações do produto ao lado dos anexos, com formatos e
variações abaixo. Os produtos podem ser recolhidos pelo cabeçalho. Na coluna
**Seus pedidos**, **Ver prévia** abre a preparação e **Detalhes** mostra formatos,
vídeos de referência, andamento e cancelamento. **Gerenciar**, em armazenamento
local, consulta os arquivos elegíveis antes de oferecer a remoção.

A sessão do painel é independente da conexão da extensão. Enquanto o painel é
usado, ela é renovada antes de expirar; ao voltar após inatividade ou reinício do
servidor, a recuperação preserva campos e arquivos selecionados. Se a renovação
falhar, o painel apresenta uma mensagem em português. Falhas de rede ou de
servidor não provocam reenvio automático de operações.

Em **Imagens de referência**, selecione várias imagens de uma vez ou adicione
mais em novas seleções. Marque **Principal no Flow** na imagem usada na geração;
a primeira começa marcada e pode ser trocada. Todas as imagens ficam no pedido
e são entregues ao agente. É possível remover cada uma separadamente; ao remover
a principal, a primeira imagem restante passa a ser a principal. O limite é de
8 MB por imagem e 30 materiais por produto, incluindo os materiais adicionais.

1. Abra <http://127.0.0.1:4319/orders>, reúna produtos e selecione a imagem de
   referência e os materiais adicionais de qualquer pasta acessível.
2. Defina formatos e quantidades por produto. O modo de clonagem vincula um único
   MP4 do produto; outra referência deve ser preparada em outro pedido/lote.
3. Salve e peça ao agente: “Prepare o pedido 12”. `flow_checkout` retorna a
   reserva, informações, materiais verificados, contrato e instruções completas.
4. O agente confere os materiais, formatos, quantidades e conteúdo e usa
   `flow_publish` com `execute=true` e `userAuthorized=true`. O mesmo pedido no
   chat autoriza preparar e despachar, incluindo os créditos previstos, sem hash
   de aprovação e sem outra confirmação. A extensão autorizada é escolhida
   automaticamente quando há somente uma; vários destinos exigem sua escolha.
5. Acompanhe as etapas, falhas e downloads no painel ou na extensão. Os projetos
   são preparados por lote e recuperados pelo vínculo persistido.

A extensão organiza as funções nas abas **Início** (resumo e pedidos),
**Fila e gerações** (takes, andamento e histórico) e **Configurações** (conexão
local), sem controles de testes simulados. **Limpar fila** remove os takes
finalizados (concluídos, falhos ou cancelados) da lista e dos totais do dashboard,
inclusive após reabrir a extensão. Takes pendentes, em execução ou com resultado
incerto permanecem visíveis. Histórico, vídeos e autorizações são preservados.
A fila destaca o produto e o take atual em um card com etapas verticais de
referência, imagem, vídeo e MP4, status e tempo na etapa em andamento. Falhas e
resultados incertos interrompem o indicador de processamento e pedem revisão.
Após confirmar o download de um take real, a fila aguarda 15 segundos antes de
iniciar o próximo take do Flow.
O dashboard acompanha o projeto atualmente aberto na aba do Flow. Ao voltar à
página inicial ou fechar a aba, retira o projeto anterior e orienta a iniciar uma
nova produção. Essa atualização consulta apenas a localização da aba; a leitura
da sessão/projeto continua no botão **Verificar projeto**, sem gerar mídia.
**Revisar pedido** abre o diagnóstico do grupo bloqueado, com a situação da
preparação, as mensagens de envio e o histórico de geração. No painel local,
**Ver diagnóstico** também consulta pedidos que ainda não foram preparados ou
enviados. Registros antigos sem causa detalhada são identificados como tal.
**Ver histórico** mostra as etapas do take; **Encerrar tentativa** encerra um
resultado incerto como falha, sem exigir nota ou confirmação adicional e sem
registrá-lo como download concluído.
Quando há um envio de vídeo registrado, **Verificar resultado no Flow** consulta
a operação da tentativa mais recente e a listagem do projeto aberto. O resultado
mostra se o vídeo e a imagem de origem foram localizados, além do estado e dos
códigos retornados pelo Flow, sem gerar mídia, recarregar a aba ou alterar a fila.
A imagem também recebe uma consulta direta. O diagnóstico distingue um registro
de geração localizado de um arquivo de vídeo disponível; um registro recebido
ou pendente ainda não confirma que o MP4 está pronto.
Até localizar o vídeo, a extensão mostra **Aguardando confirmação do Flow**;
o identificador de envio não comprova que a geração começou.
Se o Flow confirmar que um take falhou ou não foi enviado, use **Solicitar revisão
no chat** no diagnóstico do pedido ou na extensão. A solicitação vale para um
take e registra uma tentativa separada no histórico após a revisão.
Com o protocolo v8, a extensão recarrega a mesma aba do projeto e espera a sessão
ficar pronta antes de enviar a nova tentativa. Se uma tentativa anterior já
registrou a geração da imagem, a nova tentativa usa essa imagem como frame
inicial e solicita apenas o vídeo. Takes que compartilham imagem continuam
usando a imagem do take de origem. A extensão localiza a imagem pelo cartão do
projeto ou pela consulta de mídia. Se a imagem registrada estiver ausente ou a
identificação for ambígua, a tentativa para antes de pedir o vídeo.
O pedido de revisão e geração no chat também permite processar a fila se ela estiver pausada.
Se o vídeo já foi localizado, confira o projeto e os downloads. Se o take depende
de uma imagem de outro take, conclua primeiro a geração de origem.
No cartão do pedido, **Autorizar tentativa automática** permite uma tentativa
extra por take durante 24 horas, para falhas comprovadas antes do envio. O painel
mostra o orçamento adicional e permite desativá-lo. Resultados incertos após
o envio continuam exigindo revisão do Flow.
Quando o acompanhamento do Flow devolve `PUBLIC_ERROR_UNSAFE_GENERATION`, a
extensão mostra a recusa na verificação de segurança e encerra o take com falha.
O conteúdo precisa de revisão antes de uma nova tentativa autorizada.
Em uma recusa confirmada, a fila segue com os próximos takes independentes.
**Solicitar revisão no chat**, na extensão ou no diagnóstico do pedido, copia
uma solicitação identificando o take. Ao enviá-la no chat, você autoriza revisar
o conteúdo e gerar uma única nova tentativa de vídeo com a imagem existente.
O agente usa `flow_review_take` para consultar a captura de instruções da preparação,
os materiais, os textos utilizados e a imagem vinculada. A chamada
`flow_prepare_take_revision` com `execute=true` e `userAuthorized=true`
salva a versão revisada e enfileira a tentativa na mesma operação. O custo é de
zero imagens e um vídeo. O agente informa as alterações e o resultado no chat.
Para “apenas revisar”, “preparar”, “para aprovação” ou “não execute”, usa `execute=false`.
Nesse caso, `flow_approve_take_revision` executa a versão quando você solicitar.
O histórico vincula a versão à tentativa que a utilizou e preserva a entrada
original, os materiais, os parâmetros e os vídeos concluídos. Grupos
`preserve-copy` mantêm sua fala conferida e admitem revisão da direção de animação.
Uma nova recusa exige outra revisão do conteúdo.
A consulta **Verificar resultado no Flow** também lê esse acompanhamento para
identificar a recusa em tentativas anteriores.
Após aceitar o envio do vídeo, se o Flow recusar temporariamente a consulta ao
projeto ou ao link do MP4, a extensão repete apenas essas leituras com esperas
progressivas. Se ainda falharem, o diagnóstico indica qual consulta falhou.
**Conferir projeto no Flow** abre o projeto vinculado. A consulta não reenvia
gerações; retomadas de grupos bloqueados continuam exigindo nova autorização
explícita no chat. Depois da revisão, **Solicitar nova tentativa no chat** copia
uma solicitação vinculada ao grupo e à revisão atual para você enviar ao agente.
**Encerrar este grupo** encerra as gerações restantes com um clique, sem campo
de nota nem confirmação adicional. Takes pendentes, em execução ou com resultado
incerto precisam ser resolvidos antes. Os vídeos prontos e o diagnóstico ficam
preservados. Um pedido com vídeos concluídos e grupos abandonados aparece como
**Encerrado parcialmente**, em vez de continuar exigindo revisão.

No painel, **Limpar lista** remove os pedidos sem envio ou já encerrados.
**Limpar da lista** faz o mesmo para um pedido específico. A limpeza persiste
após atualizar ou reabrir o painel e também retira da extensão os takes
finalizados desses pedidos. Pedidos em preparação, execução ou revisão
permanecem visíveis. Não há confirmação adicional. Os registros internos e
materiais são preservados; pedidos removidos não podem ser preparados ou
despachados novamente.

Quando todos os pedidos da lista forem limpos, a numeração dos novos pedidos
recomeça em **#1**. Os UUIDs internos continuam únicos, e os diretórios de
preparação dos novos ciclos são separados por UUID para preservar os anteriores.
Os números usados no chat e na API consultam o ciclo atual. A consulta histórica
por UUID continua disponível em `GET /manage/orders/id/UUID`.

Para revisar antes de gerar, diga “Apenas prepare o pedido 12, não execute”. O
agente publica com `execute=false`; nenhuma geração é enviada. Depois, “Execute
o pedido 12” permite `flow_approve` pelo número, sem hash. Arquivos e materiais
não autorizam consumo. Novos pedidos não entram implicitamente na seleção.
Falhas, resultados incertos e retomadas continuam exigindo consulta e revisão.

`flow_list_orders` e `flow_show_order` consultam; `flow_renew` renova a reserva de
30 minutos. `flow_read_material` fornece o conteúdo real ao agente.
`flow_library_status`, `flow_library_read` e `flow_library_save` permitem operar
os arquivos locais. Na preparação, uma leitura adicional deve usar a revisão da
reserva; alterações não mudam preparações em andamento.

Os formatos disponíveis são quatro formatos de fábrica, POV + Vendedora, Full
POV, Full Vendedora e clonagem. Todas as variações têm gancho, Body e CTA.
Full POV e Full Vendedora usam uma imagem gerada no gancho e reutilizada nos
outros takes. Fábrica e POV + Vendedora usam duas imagens, com CTA reutilizando
o Body. Na clonagem, o agente identifica as cenas do MP4 e registra sua análise
em `cloneVideo.analysis`. O campo `cloneVideo.scenePlan` define `scenes` com
IDs e imagens e associa `takes.hook`, `.body` e `.cta` a esses IDs. Uma cena
repetida reutiliza diretamente a imagem do primeiro take que a gerou; cenas
distintas recebem imagens próprias, inclusive no CTA. Isso admite uma, duas ou
três imagens, sem amarrar o CTA ao Body. O checkout entrega o mapa vazio, sem
presumir a composição. Não combinar esse plano com `hookImage`, `presenterImage`
ou `imageStrategy`. Preparações anteriores mantêm os contratos legados.
A foto principal continua sendo a referência do produto, inclusive quando é um
print de anúncio; o vídeo orienta a estrutura e a composição. Preparações e takes
já registrados preservam seus manifestos e vínculos. A atualização do software
não sincroniza bibliotecas locais existentes; os critérios estão na edição
versionada de `instrucoes/formatos/clone.md`.
Nos novos despachos, os três MP4s de cada vídeo ficam juntos em
`Flow/Videos/<produto>--<formato>--<identificador>/`, dentro dos downloads do
Chrome. Cada pasta contém `01-Gancho.mp4`, `02-Body.mp4` e `03-CTA.mp4`. As pastas
dos vídeos ficam diretamente em `Flow/Videos`, sem o nível de lote. A extensão e
o orquestrador precisam do protocolo v6 para esse destino. Takes já registrados
mantêm o destino gravado.

O padrão técnico usa Nano Banana Pro e Omni 1.1 Flash Frames, 8 s/720p, 9:16.
Os limites de materiais são 64 MB para MP4 e 8 MB para imagens e documentos.

O compilador seleciona um template próprio para o gancho de esteira inclinada
quando o pacote o fornece. A direção de correia, deslocamento e queda pertence
a esse arquivo externo; os outros formatos não recebem essa mecânica. Templates
históricos continuam disponíveis para preparações anteriores.

Alternativa pela CLI, após o build:

```sh
pnpm orders list
pnpm orders show 12
pnpm orders checkout 12 15
pnpm orders renew .cache/orders/12
pnpm orders publish .cache/orders/12/preparacao.json --execute
# Somente preparação para revisão:
pnpm orders publish .cache/orders/15/preparacao.json
# Quando o usuário pedir executar a preparação existente:
pnpm orders approve 15 --approve
```

A execução deve corresponder ao pedido direto no chat. Com várias extensões, informe
`--client UUID`. O contrato do servidor é conferido antes da preparação; erros
retornam os campos envolvidos. Não adapte JSON a um servidor desatualizado.

## Despacho bloqueado

Use `flow_review_dispatch` para consultar o grupo e o diagnóstico, sem retomar.
O resultado apresenta os hashes, quantidades máximas e se a recuperação é segura.
Depois de revisar e obter autorização explícita no chat, `flow_resume_dispatch`
pode autorizar apenas esse grupo, preservando materiais, preparação e demais
resultados. A autorização anterior e o corpo do despacho ficam no histórico.

Essa recuperação exige falha comprovadamente anterior ao envio da criação do
projeto e nenhum take registrado no lote. Resultados incertos, grupos já
registrados e identidades revogadas são recusados. Não há repetição automática
nem reconstrução de pedidos para contornar uma confirmação perdida.

## Desenvolvimento e validação

Node.js e TypeScript estrito, pnpm Workspaces e versões exatas no lockfile.
`packages/protocol` contém contratos e compilação; `packages/orchestrator`, API,
SQLite e fila; `packages/extension`, contexto do navegador e execução.
`shared/styles/theme.css` reúne os estilos básicos usados pelo painel, conexão
e extensão; os builds copiam o tema para seus respectivos arquivos distribuídos.
`skills/` contém apenas orientação operacional. O pacote criativo é externo.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
pnpm check
pnpm test:docker
docker compose config --quiet
pnpm test:browser:formats
pnpm test:browser:library
pnpm test:browser:cloning
pnpm test:browser:orders --format=clone
pnpm test:browser:orders --format=clone --clone-scenes=abc
pnpm test:browser:orders --format=clone --clone-scenes=aba
pnpm test:browser:orders-design
pnpm test:browser:queue-design
pnpm test:browser:connect
pnpm test:browser:flow --flow-status-only --port=4399
pnpm test:browser:session
```

`pnpm test:docker` usa projeto, imagens, porta e volume próprios; verifica build,
conector MCP, isolamento, sincronização da extensão e persistência após reinício.
Não atualiza a instalação em uso. O volume sintético permanece identificado na saída.
`pnpm dev` inicia o servidor no host somente para desenvolvimento.

Os testes usam contratos sintéticos, SQLite temporário e Chrome isolado com
fixtures, sem perfil pessoal, Flow real ou consumo. `pnpm test:browser --port=4389`
valida também as abas da extensão, navegação por teclado, resumo e cards
horizontais em larguras de 280 a 640 px. A opção `--port` usa uma cópia isolada
da extensão para preservar o servidor da instalação na porta 4319.
`test:browser:formats` usa 4339; `test:browser:library`, 4349; clonagem, 4329; design de pedidos, 4359;
conexão, 4369. `test:browser:connect` cobre a página com identidades sintéticas e
WebSocket autenticado: confirmação, cancelamento, expiração, estados de conexão,
revogação e nova autorização, com capturas de 320 a 1920 px.
`test:browser:session` usa a porta 4379 e verifica renovação da sessão, preservação
do rascunho e recuperação limitada, incluindo ausência de reenvio de escritas
após resposta perdida ou erro do servidor.
A validação de design cobre criação, anexos, prévia, detalhes e cancelamento,
com capturas entre 320 e 1920 px. A instalação real é preservada.
Testes e build não comprovam nova geração paga nem qualidade criativa.

Em 4 de novembro de 2026, o usuário relatou boa qualidade nos vídeos, mas o
andamento confirmou 27 de 36 takes concluídos e um grupo bloqueado antes da
fila. Também relatou movimento insuficiente na esteira inclinada. Essas evidências
são distintas dos testes sintéticos e não autorizam reenvios pagos.

A integração com a aba do Flow é inspirada no
[FlowKit](https://github.com/crisng95/flowkit), referência `19cb87d`. O código
adaptado preserva a [licença MIT](packages/extension/public/FlowKit-LICENSE.txt).
Não recarregue a aba do Flow durante execução para atualizar a listagem.

## Opções dos pedidos

O seletor “Modelo de vídeo no Flow” vale para todos os vídeos do pedido:
Omni 1.1 Flash (`abra_i2v_8s`, padrão) ou Veo 3.1 Lite (`veo_3_1_i2v_lite`).
O modelo escolhido aparece no acompanhamento. Pedidos antigos sem o campo usam
o padrão ao compilar, sem alterar seu corpo. Nano Banana Pro continua gerando
as imagens e a reutilização mantém o modelo escolhido para cada vídeo.

Grupos de clonagem podem adaptar formato e criar nova copy (`adapt-format`) ou
manter a copy original com outro cenário/avatar (`preserve-copy`). O modo antigo
sem campo continua sendo adaptação. Em preservação, o agente confere o áudio e
registra `cloneVideo.transcript` em gancho, Body e CTA; `copy` deve ser idêntica
a cada trecho, inclusive espaços, e todas as variações do mesmo vídeo no produto
usam a mesma transcrição. O servidor valida a igualdade, sem transcrever áudio.
A revisão mostra modo e transcrição. Limitações de áudio, duração ou oferta
exigem orientação antes da publicação. Preservar texto não reutiliza o áudio nem
a identidade/voz da pessoa original. As regras criativas estão em `formatos/clone.md`.
