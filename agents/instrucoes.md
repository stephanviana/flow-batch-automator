# Instruções de preparação de lotes

Esta pasta guarda as instruções ativas, versionadas com o projeto. O material
de origem Copy V10 e Imagem V27 foi convertido e adaptado para o workflow local.
Os TXT originais não são mantidos. O swipe de fábrica corrigido foi analisado
e suas regras incorporadas a `copy.md`, sem versionar a transcrição bruta nem
torná-la dependência de execução. O swipe anterior foi substituído; os de POV
e Full Vendedora ainda serão fornecidos.

## Ordem de leitura

1. [Orquestrador](orquestrador.md): entrada do produto, coordenação da preparação,
   ligação com o contrato de importação e limites atuais do executor.
2. [Copy](copy.md): três variações por padrão, com gancho, Body e CTA; modos
   referência do dia e repertório estrutural independentes.
3. [Imagem](imagem.md): JSON de três chaves por imagem estática e catálogo dos seis
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

- A entrega manual em blocos de conversa virou preparação de artefatos e de um
  manifesto `lote.json`, sem misturar a apresentação humana com o contrato HTTP.
- O prompt de imagem continua em JSON com `prompt`, `negative_prompt` e
  `aspect_ratio`. Esse JSON é preservado como texto em `original.imagePrompt`.
- As falas completas são relacionadas por variação e take; o template de vídeo
  recebe exatamente o texto de `original.copy` do respectivo take.
- Preparar instruções, falas e JSON não autoriza gerar mídia. O consumo de
  créditos continua dependendo do painel e do vínculo imutável com o lote.
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

Cada variação gera duas imagens e três vídeos: o gancho gera sua imagem; o Body
gera a imagem da vendedora; o CTA reutiliza exatamente o ID dessa imagem, sem
gerar outra. O compilador registra o vínculo e salva os três MP4s juntos na pasta
da variação, com nomes de gancho, Body e CTA. O gancho POV usa voz fora de câmera
e mantém somente as mãos visíveis, sem coro ou lip-sync visível. A qualidade
desse áudio depende de validação real no Flow. Veja o percurso completo em
[orquestrador.md](orquestrador.md).
