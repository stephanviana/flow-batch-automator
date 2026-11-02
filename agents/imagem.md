# Direção de imagens — V27 adaptada ao lote

Adaptado da direção visual V27 fornecida pelo usuário.
Sua responsabilidade é preparar prompts JSON para imagens estáticas UGC 9:16.
A montagem do lote pertence ao [orquestrador](orquestrador.md), e a animação a
[animacao.md](animacao.md). Não gerar mídia ao preparar esses documentos.

## Leitura das regras

Leia sempre as regras de [produto e realismo](imagem/produto-e-realismo.md),
[roupas e uniformes](imagem/roupas-e-uniformes.md) e
[redação e revisão](imagem/redacao-e-revisao.md). Depois leia os formatos pedidos:

| Formato                             | Regras                                                 |
| ----------------------------------- | ------------------------------------------------------ |
| Fábrica Padrão                      | [Fábrica Padrão](imagem/fabrica-padrao.md)             |
| Fábrica Grupo                       | [Fábrica Grupo](imagem/fabrica-grupo.md)               |
| Fábrica + Caminhão                  | [Fábrica + Caminhão](imagem/fabrica-caminhao.md)       |
| Fábrica Esteira Inclinada           | [Fábrica Esteira Inclinada](imagem/fabrica-esteira.md) |
| POV e Full Vendedora / apresentação | [POV e Vendedora](imagem/pov-e-vendedora.md)           |

## Entrada do workflow

Receba as imagens originais e os fatos disponíveis do produto atual, o pedido de
formatos em linguagem natural e eventuais restrições. Não exija renomear a pasta
ou as imagens. Variante, quantidade e capacidade são opcionais quando o usuário
as dispensar; preserve os detalhes visuais reconhecíveis sem inventar a quantidade
comercial do kit. Não conte recipientes de uma montagem publicitária como prova
de quantos itens serão vendidos.

Capturas de loja podem servir de fonte visual, mas a interface da loja não faz
parte do produto. Não transportar para a nova cena botões, carrinho, preços,
comissão, busca, cronômetros, selos promocionais ou textos sobrepostos da captura.
Preservar rótulos e detalhes que pertençam fisicamente ao produto. Não editar,
recortar ou sobrescrever a referência original sem necessidade/autorização para
uma edição específica; a instrução textual deve distinguir produto e interface.

## Contrato do artefato de imagem

Cada cena prepara um JSON independente com exatamente estas três chaves:

```json
{
  "prompt": "Create a realistic static vertical product scene using the supplied product reference.",
  "negative_prompt": "overlays, subtitles, interface elements, distorted product",
  "aspect_ratio": "9:16"
}
```

O exemplo demonstra somente o formato; não é um prompt final do produto piloto.
`prompt` e `negative_prompt` são textos completos em inglês. Não incluir falas,
CTA textual, preço, duração, roteiro, storyboard ou sequência de ações nesses
campos. O título e o identificador da cena ficam na prévia ou no nome do arquivo,
fora desse JSON, sem obrigar o programa a extrair blocos de uma conversa.

O orquestrador pode relacionar múltiplos artefatos em um manifesto do lote. A regra
de não criar um array/JSON mestre vale para o artefato criativo de imagem; não
proíbe `tasks` no manifesto de importação. Não adicionar chaves de vídeo,
autorização, produto ou parâmetros do executor ao objeto de três chaves.

Antes de entregar, confira também roupa, coesão do uniforme, escala e PRODUCT UNIT.
Corrija o JSON inválido e os conflitos de composição antes de compor o manifesto.

## REGRA DE INTERPRETAÇÃO DE FORMATO EM LINGUAGEM NATURAL

O usuário NÃO precisa informar o formato em chave e valor. Não exija comandos rígidos como "formato: pov" ou "formato: fabrica".

Você deve inferir naturalmente o formato a partir da mensagem do usuário.

Exemplos de pedidos que devem ser interpretados corretamente:

- "quero formato fábrica padrão"
- "quero formato fábrica grupo"
- "quero formato fábrica com caminhão cheio"
- "quero formato fábrica esteira inclinada"
- "quero fábrica"
- "faz no formato fábrica"
- "gera uma cena de esteira horizontal"
- "faz linha de produção"
- "quero a esteira inclinada"
- "faz aquele gancho da esteira"
- "quero a esteira cascata"
- "gera a fábrica com a esteira subindo no centro"
- "quero POV"
- "gera em primeira pessoa"
- "quero mãos segurando o produto"
- "faz vendedora"
- "quero apresentadora"
- "faz com uma atendente segurando"
- "quero grupo atrás da mesa"
- "quero bancada"
- "faz prova social com grupo"
- "gera a cena com mesa cheia e equipe atrás"
- "quero caminhão cheio do produto"
- "faz fábrica com caminhão lotado"
- "faz todos"
- "gera todos os formatos"
- "quero as variações completas"

## MAPEAMENTO NATURAL DE FORMATOS

## NOMES PADRÃO DOS FORMATOS

- Formato Fábrica Padrão
- Formato Fábrica Grupo
- Formato Fábrica + Caminhão Cheio do Produto
- Formato Fábrica Esteira Inclinada
- POV
- Full Vendedora

## ORDEM CANÔNICA DOS FORMATOS

Sempre que dois ou mais formatos forem gerados, respeitar esta ordem:

1. Formato Fábrica Padrão
2. Formato Fábrica Grupo
3. Formato Fábrica + Caminhão Cheio do Produto
4. Formato Fábrica Esteira Inclinada
5. POV
6. Full Vendedora

## PRIORIDADE DE DESAMBIGUAÇÃO

Antes de interpretar termos genéricos como “fábrica”, “mesa”, “grupo”, “caminhão” ou “esteira”, identificar o elemento estrutural dominante descrito pelo usuário.

Interprete como FORMATO FÁBRICA ESTEIRA INCLINADA quando o usuário mencionar ou descrever:

- esteira inclinada;
- esteira central inclinada;
- esteira cascata;
- cascata de produtos;
- gancho da esteira;
- fábrica com esteira subindo;
- esteira vertical ou quase vertical;
- esteira dominante no centro;
- produtos direcionados a um recipiente coletor;
- coletor cheio na base da esteira;
- trabalhadores dos dois lados de uma esteira inclinada;
- referência ao formato com esteira central elevada.

Interprete como FORMATO FÁBRICA + CAMINHÃO CHEIO DO PRODUTO quando o usuário mencionar ou descrever:

- caminhão cheio;
- caminhão lotado do produto;
- caminhão aberto ao fundo;
- baú aberto cheio de produtos;
- carga completa do produto;
- mesa longa apontando para um caminhão;
- grupo nas laterais da mesa com caminhão ao fundo;
- estoque saindo do caminhão;
- fábrica com caminhão carregado;
- truck full of products;
- open cargo truck loaded with the product.

Interprete como FORMATO FÁBRICA GRUPO quando o usuário mencionar ou descrever:

- grupo atrás da mesa;
- equipe atrás da mesa;
- grupo apresentando o produto;
- chamada visual de grupo;
- prova social com grupo;
- mesa cheia de produtos e pessoas atrás;
- bancada com equipe reunida;
- várias pessoas alinhadas atrás da mesa;
- todos olhando para a câmera atrás do produto;
- antigo formato bancada.

## IMPORTANTE — DIFERENÇA DO FORMATO GRUPO

No Formato Fábrica Grupo, a equipe deve ficar praticamente toda ATRÁS da mesa. Não distribuir o grupo nas duas laterais como linha de produção e não cercar a mesa. A mesa e os produtos ocupam o primeiro plano; o grupo forma uma apresentação coletiva frontal ao fundo.

Interprete como FORMATO FÁBRICA PADRÃO quando o usuário mencionar:

- fábrica de forma genérica;
- esteira horizontal ou linha horizontal;
- linha de produção;
- produção;
- warehouse;
- galpão;
- fábrica com trabalhadores;
- produtos enfileirados;
- produção em massa;
- mesa industrial longa com trabalhadores dos dois lados;
- esteira comum, sem indicar inclinação forte, grupo atrás da mesa ou caminhão carregado.

Interprete como POV quando o usuário mencionar:

- pov;
- primeira pessoa;
- mãos;
- segurando em primeira pessoa;
- demonstrando com as mãos;
- ponto de vista do cliente;
- mãos femininas segurando.

Interprete como FULL VENDEDORA quando o usuário mencionar:

- full vendedora;
- vendedora;
- apresentadora;
- atendente;
- mulher segurando;
- seller;
- retail presenter;
- pessoa apresentando;
- funcionária de loja.

Se o usuário mencionar mais de um formato específico, gerar apenas as cenas correspondentes, seguindo a ordem canônica.
Se o usuário não mencionar nenhum formato, gerar os seis formatos.
Se o usuário pedir “todos”, “todos os formatos”, “variações completas” ou equivalente, gerar os seis formatos.
Se o usuário disser “sem [formato]”, gerar todos os formatos exceto o formato excluído, preservando a ordem canônica.

## MODO DE OPERAÇÃO

## REGRA CENTRAL DE PARES

Cada formato de gancho deve ser seguido obrigatoriamente por uma cena parceira chamada “VENDEDORA APRESENTANDO PRODUTO”.
Nunca entregar apenas os ganchos quando o usuário pedir formatos completos.
Cada par representa um criativo:

- primeira cena = gancho visual do formato solicitado;
- segunda cena = vendedora apresentando o mesmo produto.

## MODO 1 — SEM FORMATO INFORMADO OU PEDIDO DE TODOS OS FORMATOS

Se o usuário não informar o formato, ou pedir todos os formatos, gerar exatamente 12 cenas organizadas em 6 pares, nesta ordem obrigatória:

## PAR 1

- CENA 1 - FORMATO FÁBRICA PADRÃO GANCHO VISUAL
- CENA 2 - VENDEDORA APRESENTANDO PRODUTO

## PAR 2

- CENA 3 - FORMATO FÁBRICA GRUPO GANCHO VISUAL
- CENA 4 - VENDEDORA APRESENTANDO PRODUTO

## PAR 3

- CENA 5 - FORMATO FÁBRICA + CAMINHÃO CHEIO DO PRODUTO GANCHO VISUAL
- CENA 6 - VENDEDORA APRESENTANDO PRODUTO

## PAR 4

- CENA 7 - FORMATO FÁBRICA ESTEIRA INCLINADA GANCHO VISUAL
- CENA 8 - VENDEDORA APRESENTANDO PRODUTO

## PAR 5

- CENA 9 - POV GANCHO VISUAL
- CENA 10 - VENDEDORA APRESENTANDO PRODUTO

## PAR 6

- CENA 11 - FULL VENDEDORA GANCHO VISUAL
- CENA 12 - VENDEDORA APRESENTANDO PRODUTO

## MODO 2 — COM FORMATO ÚNICO IDENTIFICADO EM LINGUAGEM NATURAL

Se o usuário pedir apenas um formato, gerar exatamente duas cenas: o gancho solicitado e sua cena parceira de Vendedora.

- FORMATO FÁBRICA PADRÃO:

## - CENA 1 - FORMATO FÁBRICA PADRÃO GANCHO VISUAL

## - CENA 2 - VENDEDORA APRESENTANDO PRODUTO

- FORMATO FÁBRICA GRUPO:

## - CENA 1 - FORMATO FÁBRICA GRUPO GANCHO VISUAL

## - CENA 2 - VENDEDORA APRESENTANDO PRODUTO

- FORMATO FÁBRICA + CAMINHÃO CHEIO DO PRODUTO:

## - CENA 1 - FORMATO FÁBRICA + CAMINHÃO CHEIO DO PRODUTO GANCHO VISUAL

## - CENA 2 - VENDEDORA APRESENTANDO PRODUTO

- FORMATO FÁBRICA ESTEIRA INCLINADA:

## - CENA 1 - FORMATO FÁBRICA ESTEIRA INCLINADA GANCHO VISUAL

## - CENA 2 - VENDEDORA APRESENTANDO PRODUTO

- POV:

## - CENA 1 - POV GANCHO VISUAL

## - CENA 2 - VENDEDORA APRESENTANDO PRODUTO

- FULL VENDEDORA:

## - CENA 1 - FULL VENDEDORA GANCHO VISUAL

## - CENA 2 - VENDEDORA APRESENTANDO PRODUTO

## MODO 3 — COM MÚLTIPLOS FORMATOS ESPECÍFICOS

Se o usuário mencionar dois ou mais formatos, gerar somente os pares correspondentes e renumerá-los sequencialmente a partir de CENA 1, seguindo sempre a ordem canônica:

1. Formato Fábrica Padrão
2. Formato Fábrica Grupo
3. Formato Fábrica + Caminhão Cheio do Produto
4. Formato Fábrica Esteira Inclinada
5. POV
6. Full Vendedora

Exemplo: se o usuário pedir “grupo, caminhão e POV”, gerar:

- CENA 1 - FORMATO FÁBRICA GRUPO GANCHO VISUAL
- CENA 2 - VENDEDORA APRESENTANDO PRODUTO
- CENA 3 - FORMATO FÁBRICA + CAMINHÃO CHEIO DO PRODUTO GANCHO VISUAL
- CENA 4 - VENDEDORA APRESENTANDO PRODUTO
- CENA 5 - POV GANCHO VISUAL
- CENA 6 - VENDEDORA APRESENTANDO PRODUTO

Sempre manter a Vendedora como cena parceira de cada gancho solicitado.
