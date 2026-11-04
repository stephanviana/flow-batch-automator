---
name: flow-clone-video
description: Preparar pedidos com Clonar um vídeo no Flow Batch Automator, analisando o MP4 escolhido e adaptando sua estrutura ao produto com as regras de copy, imagem e animação de agents/. Use para clonagem ou revisão de grupos clone; desenvolvimento da interface e pedidos apenas com formatos padrão seguem seus fluxos próprios.
---

# Clonar o formato de um vídeo

Trabalhe na raiz do Flow Batch Automator. Esta skill especializa a preparação
criativa dos grupos `clone`; use [flow-orders](flow-orders.md) para
consulta, checkout, reserva, publicação e autorização. Em pedidos mistos, aplique
esta especialização somente às variações de clonagem.

## Ler as regras ativas

Leia [instruções](../agents/instrucoes.md),
[orquestrador](../agents/orquestrador.md) e
[clonagem](../agents/clonagem.md). As fontes criativas são:

| Fonte                             | Aplicação na clonagem                                                                                                                                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Copy](../agents/copy.md)         | Regras comuns de fatos, linguagem comercial, naturalidade, continuidade e duração. O vídeo selecionado é a referência ativa; o repertório de fábrica não substitui sua arquitetura.                                                 |
| [Imagem](../agents/imagem.md)     | Contrato de cada imagem estática e regras comuns de [produto e realismo](../agents/imagem/produto-e-realismo.md), [vestuário](../agents/imagem/roupas-e-uniformes.md) e [redação e revisão](../agents/imagem/redacao-e-revisao.md). |
| [Animação](../agents/animacao.md) | Template de clonagem, fala exata, apoio físico, voz e bloco anti-overlay.                                                                                                                                                           |

Consulte os arquivos específicos de `agents/imagem/` quando a composição
adaptada usar aquele formato: equipe frontal, esteira, caminhão, POV ou
apresentadora. Aplique suas restrições pertinentes sem transformar a referência
em outro formato, impor fábrica a qualquer vídeo ou gerar todo o
catálogo. O grupo salvo determina a quantidade. Os repertórios de Fábrica, POV
e Full Vendedora atendem aos grupos padrão; não substituem a arquitetura do
vídeo explicitamente escolhido para um grupo `clone`.

## Conferir o vínculo e analisar

Consulte os pedidos solicitados e faça checkout conforme `flow-orders`.
Em `pedido.json`, relacione produto, grupo, `videoReferenceId` e variações
planejadas. Confira o MP4 correspondente e a foto `referenceId`; não escolha
simplesmente o primeiro vídeo da pasta. Preserve os IDs preenchidos no contrato,
inclusive `cloneVideo.materialId`, e a separação entre produtos e grupos.

Assista ao material real e confira a foto e os fatos do produto atual. Aplique
o [método de extração A–E](../agents/clonagem.md#método-de-análise-da-referência--extração-sintática-e-formato)
antes de escrever: estrutura narrativa, mapeamento frase por frase, formato
geral, template sintático e regras de fidelidade. Observe também demonstração,
câmera, atuação e voz no vídeo; distinga observações, fatos do novo produto e
adaptações necessárias.

Use os recursos de vídeo disponíveis; frames extraídos são auxiliares e não
comprovam o áudio ou o movimento completo. Se faltar acesso a uma parte essencial,
registre o limite e peça somente a transcrição ou descrição necessária antes de
publicar aquela adaptação como concluída. Continue o trabalho independente dos
demais grupos. Não invente observação, transcrição ou demonstração e não envie
materiais a serviços externos automaticamente.

## Preencher a preparação

Edite as variações já existentes em `preparacao.json`:

- `cloneVideo.analysis`: síntese verificável da extração A–E, com trechos
  decisivos e suas construções abstratas, formato, sequência e regras preservadas,
  argumento próprio de cada variação e adaptações aos limites do executor.
  Respeite os 4096 caracteres; explicite partes não analisadas. A extração fica
  na preparação, sem criar arquivos de estudo versionados.
- `copy.hook`, `.body`, `.cta`: falas próprias em português brasileiro, como uma
  copy contínua, seguindo a progressão do vídeo e os fatos do produto atual.
- `hookImage` e `presenterImage`: dois objetos de imagem estática, com `prompt`
  e `negative_prompt` em inglês e `aspect_ratio: "9:16"`, conforme `imagem.md`.
- `cloneVideo.directions.hook`, `.body`, `.cta`: direção em inglês para cada
  take, com enquadramento, câmera, ação e quem fala. As falas ficam em `copy`;
  o compilador insere o texto exato no template de clonagem.

Aplique a regra de [copy própria](../agents/clonagem.md#copy-própria-a-partir-da-estrutura-original):
mesmo para uma única variação, escreva uma nova copy para o produto a partir
da arquitetura do vídeo. Com várias, varie argumento ou ênfase sustentados,
além da redação; copiar a transcrição ou trocar apenas palavras não atende.
Mantenha a mesma arquitetura, sem mudar de estratégia a cada versão. Não transporte
atributos, preços ou condições comerciais do anúncio original. Preserve a
identidade, a escala e a unidade comercial do novo produto, as regras de roupa
e o apoio direto nas mãos ou no balcão. Registre adaptações de montagem,
demonstração ou cenário em `analysis`, sem prometer reprodução literal.

O percurso mantém duas imagens e três takes; CTA reutiliza exatamente a imagem
gerada do Body. Não crie `ctaImage`, fallback ou frames retirados do MP4 para
substituir a foto do produto. Respeite os parâmetros do pedido e o padrão de
8 s/720p, 9:16; não acrescente cortes ou overlays para imitar a edição original.

## Revisar e entregar

Antes de publicar, compare cada variação com o vídeo do seu grupo: abertura,
ordem dos argumentos, função da demonstração e fechamento ainda correspondem à
referência? Confira também originalidade da copy, diferenças entre as variações
e ocupação estimada de fala próxima de 7–7,5 segundos por take de 8 segundos,
conforme `agents/copy.md`, além de fatos sustentados, composição estática,
apoio físico, continuidade Body/CTA e compatibilidade entre quem aparece e quem
fala. Somente mãos visíveis pedem voz fora de câmera; um grupo visível não
implica coro automático. Revise o manifesto compilado e o bloco anti-overlay.

Publique e consulte o resultado conforme `flow-orders`. Apresente produto e
vídeo associado, observações e adaptações relevantes, falas, prompts, modelos,
quantidade máxima de imagens/vídeos e hash da revisão. Informe limitações reais;
validação do contrato não comprova fidelidade criativa, lip-sync ou qualidade no
Flow. Preparar/publicar não autoriza geração: qualquer despacho exige autorização
específica no chat para a revisão exata.
