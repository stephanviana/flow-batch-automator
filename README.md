# Flow Batch Automator

Ferramenta local para futura geração de imagens e vídeos em lote no Google Flow,
com Chrome no Windows e orquestrador no Docker Engine do WSL2.

**Versão 0.4.0.** Referência → imagem → vídeo → MP4, com autorização para uma imagem e um vídeo.

## Arquitetura

| Pacote                  | Responsabilidade                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/protocol`     | Contratos Zod, estados de simulação e componentes da assinatura; código compartilhado com o navegador. |
| `packages/orchestrator` | Fastify, SQLite, autorizações, desafios, gestão local, WebSocket e histórico das simulações.           |
| `packages/extension`    | Identidade IndexedDB, comunicação no service worker e popup Manifest V3; build com esbuild.            |

Node **24.22.2 LTS**, pnpm **12.15.0**, TypeScript **6.0.3**, Fastify **5.12.7**,
Zod **4.6.7** e ws **8.22.0**, com versões exatas e lockfile. A imagem Node está
fixada por digest. Não há Redis, PostgreSQL, dashboard ou serviços externos.

SQLite nativo (`node:sqlite`) usa WAL, foreign keys e busy timeout de 3 segundos.
Migrações e versões são aplicadas transacionalmente. A versão 2 acrescenta as
tabelas de comunicação sem recriar o banco da Fase 1. Autorizações e simulações
persistem após recriar containers. SIGINT/SIGTERM encerram sockets e banco;
simulações inacabadas são interrompidas também na retomada após uma queda abrupta.

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
3. A versão desta fase é **0.4.0**, identificada como **Flow Batch — Comunicação local**.

O caminho estável preserva o ID da extensão e seu IndexedDB entre atualizações.
Remover a extensão ou apagar seus dados pode eliminar sua identidade e exigir nova
autorização. O volume SQLite e os dados da extensão são persistências distintas.

## Conectar e testar

1. Abra o popup e clique em **Conectar ao Flow Batch**.
2. A extensão abre `/connect` e mostra um código de seis dígitos no popup.
   Se o popup fechar ao abrir a página, reabra-o sem clicar em Conectar novamente.
3. Compare o código do popup com o da solicitação na página local. O código vale
   por dois minutos. Clique em **Confirmar conexão** somente se forem iguais.
4. O popup passa a mostrar **Conectada e autenticada**. Nenhuma solicitação é
   aprovada automaticamente; não há código copiado do terminal.
5. Clique em **Enviar teste simulado (5 s)**. O histórico deve passar por enviada,
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

### Estados das simulações

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
vez nem implementa recuperação de gerações pagas. A máquina de estados de produção
e sua fila pertencem à Fase 3.

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

A extensão pede apenas `storage`, `alarms` e acesso HTTP ao host `127.0.0.1`.
Match patterns não restringem portas; a CSP limita HTTP/WS à porta 4319. Não há
permissões de cookies, downloads, debugger ou Google Flow. Nada captura credenciais
de contas, usa APIs privadas ou contorna CAPTCHA.

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

Há limites de payload de 16 KiB, 20 pedidos pendentes globais, 16 desafios por
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
concorrente, adulteração de bytes, interrupção e persistência; não comprovam Chrome.

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
testa heartbeat com popup fechado, reinicia servidor e navegador, verifica ausência
de reenvio e testa revogação e reautorização explícita. Logs e screenshots ficam
em `.cache/`. O teste requer bibliotecas Linux compatíveis com o navegador; não
instala pacotes do sistema automaticamente.

Chrome for Testing no Linux e o Chrome do usuário no Windows são ambientes distintos.
Após atualizar a extensão no Windows, valide manualmente conexão, simulação,
desconexão/reconexão e revogação seguindo as instruções acima. O acesso Windows
ao serviço pode ser conferido no PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:4319/health
```

Nesta entrega passaram os 23 testes no Node 24.22.2 LTS, tipos, lint, build e
formatação, a integração Docker e o fluxo real no Chrome for Testing 156 no Linux.
O banco existente recebeu a migração 2 preservando os dados da fundação. Pelo
PowerShell do Windows foram conferidos o manifest 0.2.0, `/health` e `/connect`.
O usuário confirmou no Chrome do Windows: **“Conectou e concluiu a simulação”**,
após recarregar a extensão, comparar os códigos e confirmar a conexão na página
local. Reconexão, reinícios, revogação e reautorização foram validados no Chrome
for Testing no Linux; não houve confirmação manual desses cenários no Windows.

Referências: [WebCrypto](https://www.w3.org/TR/WebCryptoAPI/),
[componentes de assinaturas HTTP](https://www.rfc-editor.org/rfc/rfc9421.html),
[WebSocket em service workers](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets),
[ciclo de vida de workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
e [ordem de inicialização do Compose](https://docs.docker.com/compose/how-tos/startup-order/).

## Fila persistente

Fila SQLite com entrada imutável, execução simulada sequencial, pausa, histórico, cancelamento, repetição segura e revisão de resultados incertos. Rotas assinadas e WebSocket com capacidade de fila; migração 3 preserva autorizações anteriores. A interface da fila será integrada no painel lateral.

## Painel lateral e leitura do Flow

O painel lateral substitui o popup, integra a fila e consulta o projeto na sessão autenticada do Flow. A leitura não gera mídia. O usuário autorizou a abordagem do FlowKit para simplificar a automação; credenciais permanecem na página e gerações pagas continuam exigindo autorização.

## Geração de take e download MP4

Referência local → imagem → vídeo → MP4. Referências ficam no IndexedDB com SHA-256, prompts preservados, uma imagem e um vídeo por autorização, tentativa única e cinco checkpoints. Conclusão exige download real confirmado pelo Chrome. O usuário confirmou: “Concluiu e baixou o MP4”.
