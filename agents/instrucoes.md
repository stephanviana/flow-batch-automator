# Instruções de preparação de lotes

Esta pasta guarda os padrões de instalação. A operação usa as instruções da
revisão da biblioteca externa entregue pelo MCP ou pelo checkout da CLI. As bases em `copy/` já
incorporam os swipes de cada formato e contêm as estruturas necessárias para
criar as falas. Para testar uma copy ou formato de referência, use a clonagem.

## Ordem de leitura

1. [Orquestrador](orquestrador.md): entrada do produto, coordenação da preparação,
   ligação com o contrato de importação e limites atuais do executor.
2. [Copy](copy.md): regras comuns de falas, com gancho, Body e CTA. Nos formatos
   padrão, ler diretamente a base de [Fábrica](copy/fabrica.md), [POV](copy/pov.md) ou
   [Full Vendedora](copy/vendedora.md).
3. [Imagem](imagem.md): JSON de três chaves por imagem estática e catálogo dos sete
   formatos. O documento indica as regras comuns e os arquivos de cada formato.
4. [Animação](animacao.md): renderização da fala exata nos templates técnicos,
   preservando o bloco anti-overlay.

Para grupos **Clonar formato de vídeo**, use a skill
[flow-clone-video](../skills/flow-clone-video.md) e leia
[clonagem.md](clonagem.md).
O vídeo selecionado é a fonte estrutural; a foto continua como referência visual
do produto. Registre a análise e as direções adaptadas antes de publicar.

Os arquivos em `imagem/` dividem as regras por responsabilidade: identidade e
escala do produto, roupas/uniformes, composição de cada formato e revisão final.
Leia as regras comuns e as dos formatos pedidos antes de preparar seus prompts.

## O que foi adaptado

- As bases de cada formato incorporam as construções sintáticas aplicáveis ao
  produto. Promoção, urgência, estoque e depoimentos não se tornam fatos por
  aparecerem em exemplos; a estrutura não garante conversão.
- A entrega manual em blocos de conversa virou preparação de artefatos e de um
  manifesto `lote.json`, sem misturar a apresentação humana com o contrato HTTP.
- O prompt de imagem continua em JSON com `prompt`, `negative_prompt` e
  `aspect_ratio`. Esse JSON é preservado como texto em `original.imagePrompt`.
- As falas completas são relacionadas por variação e take; o template de vídeo
  recebe exatamente o texto de `original.copy` do respectivo take.
- Preparar instruções, falas e JSON não autoriza gerar mídia. O consumo de
  créditos continua dependendo de autorização específica no chat e do vínculo
  imutável com a revisão exata do lote.
- Variante não é um pré-requisito quando o usuário a dispensar. Nesse caso, a
  criação permanece genérica, sem inventar quantidade ou alegações dependentes
  da variante.

## Estado da integração

Estas instruções descrevem o trabalho do agente que prepara pedidos salvos no
painel local. Não são um serviço de IA autônomo. Consulte a skill
[`flow-orders`](../skills/flow-orders.md): `pnpm orders list` lista os pedidos;
`pnpm orders checkout 12 15` reserva e obtém os materiais pela API local. O agente
edita a preparação, publica com `pnpm orders publish` e apresenta a prévia.
Somente após autorização específica no chat, `pnpm orders approve` despacha a
revisão exata. O servidor valida e compila; a criação das falas e prompts continua
sendo responsabilidade do agente que lê estas regras.

Cada variação gera três vídeos. Fábrica, POV + Vendedora e clonagem usam duas
imagens: gancho e Body; CTA reutiliza a imagem do Body. Full POV e Full Vendedora
usam uma imagem: `hookImage`, gerada no gancho e reutilizada diretamente no Body
e CTA. Nesses dois formatos, não preparar `presenterImage` nem gerar fallback.
O compilador registra o vínculo e salva os três MP4s juntos por variação.
POV + Vendedora usa voz fora de câmera no gancho; Full POV mantém somente mãos
e voz fora de câmera nos três takes. A qualidade do áudio depende de validação
real no Flow. Veja o percurso em [orquestrador.md](orquestrador.md).
