# Flow Batch Automator

Ferramenta local para preparar pedidos de TikTok Shop e gerar imagens e vídeos
no Google Flow. O painel organiza produtos, materiais, formatos e quantidades;
o agente conectado pelo MCP cria copy e prompts a partir das instruções locais;
a extensão executa os grupos autorizados.

## Instalação e instruções locais

O código da aplicação não inclui instruções criativas nem swipes. Escolha uma
pasta para seu pacote de instruções, fora do repositório:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm library init /CAMINHO/Minha-Biblioteca-Flow
pnpm library import /CAMINHO/Minha-Biblioteca-Flow /CAMINHO/pacote-instrucoes.json
pnpm library validate /CAMINHO/Minha-Biblioteca-Flow
```

`init` cria `biblioteca.json`, `.historico/` e `instrucoes/rotas.json`, com rotas
vazias. Não instala regras padrão, não cria uma pasta de swipes e não substitui
arquivos existentes. Você pode importar um pacote, copiar uma pasta existente
completa ou editar os arquivos diretamente. Sem instruções completas, o servidor
continua atendendo pedidos e informa o que falta antes de reservar a preparação.

`instrucoes/rotas.json` aponta os documentos comuns, as bases dos formatos e o
arquivo de templates de animação. As chaves técnicas são `version` (2), `common`,
`formats` e `animation`. Os formatos correspondem aos identificadores executáveis
da aplicação. Caminhos devem ficar sob `instrucoes/`; os templates precisam
respeitar os marcadores e cabeçalhos técnicos do compilador. Pacotes históricos
mantêm sua leitura para preservar preparações existentes.

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
pnpm library export /CAMINHO/Minha-Biblioteca-Flow /CAMINHO/backup-instrucoes.json
pnpm library import /OUTRA/Minha-Biblioteca-Flow /CAMINHO/backup-instrucoes.json
pnpm library restore /CAMINHO/Minha-Biblioteca-Flow HASH_DA_REVISAO
```

Guarde o backup em outro local. O JSON inclui os arquivos atuais e as capturas
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

Baixe o conector independente para uma pasta de sua escolha. O arquivo inclui
suas dependências e exige Node.js 24.22.2 LTS ou 26.12.1:

```sh
curl --fail http://127.0.0.1:4319/agent/flow-batch-mcp.mjs -o /CAMINHO/flow-batch-mcp.mjs
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
4. O agente cria a preparação e publica com `flow_publish`. Confira a prévia:
   falas, prompts, materiais, modelos e limites de geração.
5. Autorize explicitamente no chat o número e hash exatos. Só então o agente usa
   `flow_approve`. Publicar não consome créditos.
6. Acompanhe as etapas, falhas e downloads no painel ou na extensão. Os projetos
   são preparados por lote e recuperados pelo vínculo persistido.

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
pnpm orders publish .cache/orders/12/preparacao.json
pnpm orders approve 12 --approve --hash HASH_DA_PREPARACAO
```

A aprovação exige autorização explícita no chat. Com várias extensões, informe
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
