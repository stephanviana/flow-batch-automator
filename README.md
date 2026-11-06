# Flow Batch Automator

Ferramenta local para preparar pedidos de TikTok Shop e gerar imagens e vídeos
no Google Flow. O painel organiza produtos, materiais, formatos e quantidades;
o agente conectado pelo MCP cria copy e prompts a partir das instruções locais;
a extensão executa os grupos autorizados.

## Distribuição pelo npm — WSL

O pacote de distribuição é `@nahpets01-org/flow-batch-automator`, configurado para
publicação pública em `https://registry.npmjs.org/`. A publicação disponibiliza
os arquivos compilados e as dependências incluídas; o repositório de trabalho
continua separado. O monorepo e seus workspaces permanecem `private: true` para
impedir publicação acidental do código de desenvolvimento.

Requisitos: WSL/Linux, Node.js 24.22.2 LTS (ou 26.12.1), npm e Docker com Compose
no WSL. Antigravity e Codex devem executar nesse mesmo ambiente. O suporte ao
servidor nativo no Windows fica para outra etapa.

Após a primeira publicação no registro, instale fora do repositório:

```sh
npm install --global @nahpets01-org/flow-batch-automator
flow-batch setup --extension /mnt/c/Users/SEU_USUARIO/flow-batch-extension
flow-batch library import /CAMINHO/biblioteca.md
flow-batch up
flow-batch doctor
```

`setup` cria `~/.flow-batch/biblioteca/biblioteca.md` com seções vazias se a
biblioteca não existe. `--library PASTA` é opcional; a seleção persiste.
Registra o MCP no Antigravity e no Codex com Node e caminhos absolutos do ambiente
local, preserva outros servidores e cria backups dos arquivos alterados.
`--clients codex` ou `--clients antigravity` escolhe apenas um cliente;
`--codex-config ARQUIVO` e `--antigravity-config ARQUIVO` escolhem configurações
específicas. O Codex respeita `CODEX_HOME` na primeira configuração. A seleção de
clientes e seus destinos persistem. A atualização de TOML preserva valores e tipos,
mas reserializa o documento; comentários e formatação ficam no backup.
Reabra os clientes para carregar o MCP. A instalação npm não executa configuração
automática nem encerra clientes.

Biblioteca, pedidos, materiais, SQLite, credenciais e configurações individuais
ficam fora do pacote. A configuração local usa `~/.flow-batch` por padrão;
`FLOW_BATCH_HOME` escolhe outra pasta e `--workspace PASTA` escolhe a pasta
operacional. A extensão atual usa a porta 4319, publicada só em `127.0.0.1`.
`up` constrói imagens localmente, sincroniza a extensão e espera o servidor
saudável. A instalação npm baixa as dependências declaradas. O primeiro build
Docker instala a árvore de produção fixada dentro da imagem Linux com
`npm ci --omit=dev`, além da
imagem base Node fixada por digest. Os módulos instalados no host não são copiados
para o container.
Carregue ou recarregue a extensão no Chrome e confirme em
<http://127.0.0.1:4319/connect>.

Para atualizar:

```sh
npm install --global @nahpets01-org/flow-batch-automator@latest
flow-batch setup
flow-batch up
flow-batch status
flow-batch logs
```

`flow-batch down` preserva o volume. O projeto padrão é `flow-batch-local`, com
volume `flow-batch-local_sqlite_data`. Para adotar uma instalação existente,
confira seu projeto e volume reais antes de configurar `--project NOME --volume
NOME`. O Compose da raiz normalmente usa `flow-batch-automator` e
`flow-batch-automator_sqlite_data`. Pare o Compose anterior sem remover volumes
e selecione explicitamente esses nomes no `setup`, junto às mesmas pastas de
biblioteca e extensão. A CLI não escolhe ou apaga bancos antigos automaticamente.

`flow-batch mcp` inicia o stdio. `flow-batch mcp install codex` ou `antigravity`
atualiza só o conector; `--config ARQUIVO` escolhe uma configuração específica.
Instalar ou atualizar não autoriza créditos. O pedido direto no chat para
preparar um pedido inclui sua execução; use “apenas prepare” para revisar antes.

A distribuição `0.6.1` entrega o servidor compilado em `dist/main.mjs` e os assets
em `dist/public/`, com dependências npm normais e versões exatas. O pacote não
inclui `node_modules` nem `runtime/app.tar.gz`. O conector MCP independente segue
incluído para preservar sua instalação fora do prefixo npm e o download pela API.
Esta mudança prepara uma nova versão; `0.6.0` já publicada mantém seu conteúdo.

## Gerar, auditar e publicar uma versão

`packaging/npm.json` define nome, registro e visibilidade. A versão vem do
`package.json` da raiz. `packaging/npm-files.json` é a lista exata de arquivos
permitidos no artefato; o README distribuído vem de `packaging/README.md`.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm package:npm
pnpm audit:npm
pnpm test:package
pnpm test:package --docker
pnpm publish:npm --dry-run
```

O arquivo auditado fica em
`dist/npm/nahpets01-org-flow-batch-automator-0.6.1.tgz`.
`pnpm package:local` continua disponível como alias de `package:npm`; a geração
local não publica no registro. Também é possível instalar esse arquivo diretamente
com `npm install --global --ignore-scripts /CAMINHO/ARQUIVO.tgz`; a primeira
instalação precisa obter as dependências do registro.

`pnpm-lock.yaml` continua sendo a fonte das versões do projeto. O empacotamento
consulta sua árvore de produção, gera `runtime/package-lock.json` com as
ferramentas npm e verifica versões, URLs públicas, integridades e resolução
das dependências.
Esse lockfile é usado explicitamente por `npm ci` no Docker. É um artefato de
distribuição incluído no pacote; não é um segundo lockfile de desenvolvimento
para manter manualmente. A geração recusa divergências
em relação à árvore pnpm, inclusive quando duas versões da mesma biblioteca são
necessárias. O Docker usa esse mesmo lockfile e instala as dependências dentro
da imagem. Seu contexto exclui os módulos do host.

A instalação global segue a resolução normal do npm para dependências transitivas;
o lockfile de produção congela explicitamente o servidor executado pelo Docker.
Isso mantém compatibilidade com npm 11 e 12: a linha 12 retirou o suporte a
`npm-shrinkwrap.json`. Não se promete uma árvore global transitiva congelada pela
mera presença de um lockfile no pacote. A CLI usa suas dependências diretas exatas
e o conector independente conserva o bundle validado.

Somente o código da aplicação é compilado junto: suas bibliotecas de produção são
resolvidas pelo npm. O protocolo privado do workspace é incorporado ao código
compilado, sem publicar outro pacote ou referências `workspace:`/caminhos locais.
O MCP independente e a extensão mantêm seus bundles para executar nos ambientes
próprios. Licenças e atribuições continuam preservadas.

A auditoria percorre o `.tgz`, verifica a lista de arquivos, o manifesto, o
lockfile de produção e seus destinos. Bloqueia arquivos compactados internos,
`node_modules` embutido, dados locais, source maps, caminhos pessoais reconhecidos e padrões
conhecidos de tokens/chaves, sem exibir os valores encontrados. Um resultado sem
achados não substitui a revisão do que a aplicação e suas dependências distribuem.

Para publicar no WSL, autentique-se com
`npm login --auth-type=web --browser=false --registry=https://registry.npmjs.org/`
na conta autorizada para a organização. Abra a nova URL manualmente no navegador
e espere a confirmação no terminal; depois confira com `npm whoami`. Não envie
tokens, senhas ou códigos de autenticação pelo chat.
Depois de revisar o nome, versão, acesso público e SHA-256 exibidos pela auditoria:

```sh
pnpm publish:npm
```

Esse comando audita uma cópia do arquivo exato imediatamente antes de executar
`npm publish`, usando o registro e a visibilidade configurados. `--dry-run` simula
a publicação. Não publique a raiz do repositório nem os diretórios de implantação.
Para uma atualização, incremente a versão antes de gerar outro pacote; o npm
não permite substituir uma versão já publicada.

## Instalação e instruções locais

Novas instalações usam um único `biblioteca.md`. O `setup` cria sua estrutura
vazia automaticamente; o aplicativo não inclui instruções criativas nem swipes.
Peça ao agente para preencher o documento ou importe um arquivo já configurado:

```sh
flow-batch library import /CAMINHO/biblioteca.md
flow-batch library validate
```

O arquivo começa com `<!-- flow-biblioteca:1 -->` e usa seções de primeiro nível:
`# [common]`, `# [copy]`, `# [image]`, uma seção por formato (`# [factory]`,
`# [factory-group]`, `# [factory-truck]`, `# [factory-inclined]`, `# [pov]`,
`# [full-pov]`, `# [seller]`, `# [clone]`) e `# [animation]`.
O texto após cada marcador é o título livre da seção. Cabeçalhos normais e blocos
de código podem ser usados dentro delas. Não há mapa de caminhos para configurar.
Use pelo menos uma seção comum e preencha os formatos usados no pedido; a seção
de animação mantém os templates e marcadores técnicos exigidos pelo compilador.
Seções desconhecidas, repetidas e blocos de código sem fechamento são recusados.

O MCP seleciona as seções comuns e dos formatos pedidos. As cópias técnicas no
workspace de preparação não são novas fontes de instruções: atualize sempre o
`biblioteca.md` local, por edição direta ou com `flow_library_read` e
`flow_library_save` (o caminho padrão dessas ferramentas é `biblioteca.md`).
`biblioteca.json` e `.historico/` são metadados administrados pelo aplicativo.
Uma biblioteca incompleta não impede abrir o painel; a reserva informa as seções
que faltam, sem buscar conteúdo no código.

Bibliotecas existentes em `instrucoes/` continuam funcionando. Para converter:

```sh
flow-batch library convert
```

A conversão reúne regras, formatos e templates em `biblioteca.md` e preserva os
originais em `.rascunhos/`. Reservas e preparações antigas preservam suas capturas.
Não misture os dois formatos na pasta ativa. Importação de backups JSON antigos
também continua disponível. Para escolher outra pasta em qualquer comando,
informe-a antes do arquivo, como `library import PASTA ARQUIVO`.

No checkout de desenvolvimento, `pnpm library` oferece os mesmos comandos após
`pnpm install --frozen-lockfile` e `pnpm build`. `init [PASTA]` cria somente a
estrutura vazia; sem destino explícito, usa a configuração local ou a pasta padrão.

Copie `.env.example` para `.env`. Configure `WIN_EXTENSION_DIR` com uma pasta
existente para a extensão do Chrome e `FLOW_LIBRARY_DIR` com a pasta de instruções.
Ambos são caminhos do ambiente que executa Docker Compose. No WSL, use caminhos
Linux, inclusive `/mnt/c/...` quando escolher uma pasta Windows.

```sh
docker compose up -d --build
```

O Compose monta somente a pasta escolhida de instruções em `/library`. SQLite e
materiais dos produtos continuam no volume persistente administrado pela aplicação.
A aplicação roda sem privilégios e publica apenas `127.0.0.1:4319`. Não altere a
pasta global de downloads do Chrome. Carregue a extensão não empacotada no destino
configurado e confirme a conexão em <http://127.0.0.1:4319/connect>.

Fora do Compose, `LIBRARY_DIR` escolhe a pasta; o padrão é
`~/.flow-batch/biblioteca`. `.env` é lido pelo Compose, não pela execução direta.
Uma atualização de software preserva suas instruções e não importa conteúdo novo.

## Backup e mudança de computador

```sh
flow-batch library export /CAMINHO/biblioteca.md
# Na outra máquina, depois de setup:
flow-batch library import /CAMINHO/biblioteca.md
# Backup completo com histórico:
flow-batch library export /CAMINHO/backup-instrucoes.json
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
outros takes. Os demais usam duas imagens, com CTA reutilizando o Body.
Os três MP4s ficam separados na mesma pasta da variação: `01-Gancho.mp4`,
`02-Body.mp4`, `03-CTA.mp4`. Padrão técnico: Nano Banana Pro e Omni 1.1 Flash
Frames, 8 s/720p, 9:16. Materiais: MP4 até 64 MB; imagens e documentos até 8 MB.

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
`skills/` contém apenas orientação operacional. O pacote criativo é externo.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
pnpm check
pnpm package:npm
pnpm audit:npm
pnpm test:package
pnpm test:package --docker
docker compose config --quiet
pnpm test:browser:formats
pnpm test:browser:library
pnpm test:browser:cloning
```

Os testes usam contratos sintéticos, SQLite temporário e Chrome isolado com
fixtures, sem perfil pessoal, Flow real ou consumo. `test:browser:formats` usa
4339; `test:browser:library`, 4349; clonagem, 4329. A instalação real é preservada.
Testes e build não comprovam nova geração paga nem qualidade criativa.

Em 4 de novembro de 2026, o usuário relatou boa qualidade nos vídeos, mas o
andamento confirmou 27 de 36 takes concluídos e um grupo bloqueado antes da
fila. Também relatou movimento insuficiente na esteira inclinada. Essas evidências
são distintas dos testes sintéticos e não autorizam reenvios pagos.

A integração com a aba do Flow é inspirada no
[FlowKit](https://github.com/crisng95/flowkit), referência `19cb87d`. O código
adaptado preserva a [licença MIT](packages/extension/public/FlowKit-LICENSE.txt).
Não recarregue a aba do Flow durante execução para atualizar a listagem.
