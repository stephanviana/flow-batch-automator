# Redação e revisão dos prompts de imagem

Leia o contrato em [imagem.md](../imagem.md); a auditoria abaixo se aplica ao
artefato criativo, antes de sua inclusão no lote pelo orquestrador.

## COMO ESCREVER O CAMPO PROMPT

Todo prompt deve descrever UMA ÚNICA IMAGEM ESTÁTICA. Nunca descreva começo, meio e fim, duração, transição, aproximação em andamento, giro, clique, queda em movimento ou sequência de ações.

Todo prompt deve:

- começar com um verbo operacional claro, como “Recreate”, “Generate” ou “Create”;
- orientar o uso da imagem enviada como referência exata de identidade do produto;
- explicar a relação entre referência e nova cena: a referência preserva identidade e proporções internas, enquanto a escala final vem da dimensão real, anatomia e perspectiva;
- deixar claro que o produto real deve ser preservado em identidade, forma, proporções internas, materiais e detalhes principais;
- quando o produto for composto, declarar explicitamente o PRODUCT UNIT LOCK antes de descrever multiplicação, estoque ou organização da cena;
- quando houver pessoas, escolher roupas apenas a partir da whitelist positiva apropriada ao contexto;
- usar capacidade, volume ou dimensões fornecidas como âncoras positivas de escala;
- descrever o cenário e o tipo de cena;
- reforçar integração física realista;
- nas cenas de apresentação, definir produto diretamente nas mãos ou no balcão, sem acessórios de apoio inventados; seguir [produto e realismo](produto-e-realismo.md#cenário-apoio-e-componentes-do-produto);
- reforçar escala humana correta com comparações concretas quando necessário;
- evitar produto estendido em direção à câmera;
- reforçar perspectiva natural de 35–50 mm em cenas com vendedora;
- reforçar iluminação coerente;
- reforçar estética UGC realista;
- fechar com instruções de vertical 9:16.

## MODELO CONCEITUAL DE ABERTURA DO PROMPT

Você não precisa copiar literalmente, mas siga esta lógica:
"Recreate the uploaded product as a true-to-life real-world object. Use the uploaded image to preserve its exact identity, category, silhouette, internal proportions, materials, colors and distinctive details. If the reference is a kit, set, pack, bundle or multi-piece commercial product, first define the complete assembled set as one indivisible PRODUCT UNIT and preserve its exact internal component architecture in every occurrence. Determine its final physical size from the real product category, any user-provided capacity or dimensions, anatomical scale and natural camera perspective. Create a realistic UGC image showing..."

## CONTEÚDOS PROIBIDOS NO PROMPT

Não incluir:

- texto na tela;
- legendas;
- locução;
- falas;
- duração em segundos;
- CTA textual;
- preço, desconto ou oferta inventada;
- marcadores gráficos;
- animações;
- movimento de câmera descrito como ação temporal;
- sequência de conexão, demonstração ou uso;
- roteiro por benefícios;
- linguagem de vídeo como “then”, “after”, “finally”, “the camera moves”, “the product rotates” ou equivalentes.

Quando precisar indicar câmera, descreva apenas a fotografia estática, por exemplo: “eye-level smartphone framing”, “front-centered composition”, “strict first-person POV” ou “slightly elevated static viewpoint”.

## COMO ESCREVER O CAMPO NEGATIVE_PROMPT

O negative prompt deve ser um texto em inglês contendo os principais erros a evitar para aquela cena específica, combinando:

- os erros globais;
- os erros do formato;
- os riscos específicos do produto;
- quando houver pessoas: roupa fora da whitelist positiva, styling incompatível com o contexto, aparência de influencer/editorial ou roupa inconsistente com a cena;
- quando houver equipe de fábrica/warehouse: “mixed uniforms, mixed uniform types, mismatched workwear, mixed coveralls and polos, mixed vests and T-shirts, some workers wearing vests while others do not, inconsistent team uniform”;
- quando houver produto composto: os erros do PRODUCT UNIT LOCK, incluindo kit desmontado, componentes soltos, estoque separado por cor, pilhas monocromáticas, conjunto incompleto, ordem errada, componente faltando ou componente extra.

## REGRAS DE CONSISTÊNCIA

- Se o usuário pedir todos os formatos, as 12 cenas devem refletir o mesmo produto corretamente, mantendo o mesmo produto dentro de cada par.
- Não mudar o produto entre cenas.
- Pode variar o cenário, a pessoa, a escolha cromática das roupas e a composição, mas não a identidade real do produto.
- Em cenas com equipe, a variação de roupa ocorre entre gerações; dentro de cada imagem, todos os trabalhadores devem manter o mesmo arquétipo e a mesma solução cromática contextual de uniforme.
- Sempre priorizar legibilidade do produto sem aumentar sua escala física.
- Sempre manter coerência visual entre produto, escala humana e ambiente.
- A imagem de referência controla identidade; a dimensão real, a anatomia e a perspectiva controlam a escala final.
- Para produto composto, a imagem de referência também controla a definição e a arquitetura interna do PRODUCT UNIT; nenhuma cena pode desmontá-lo.
- Conferir se bandejas, cestas, tábuas ou bases portáteis foram acrescentadas apenas para sustentar o kit. Se não forem componentes reais confirmados, removê-las da direção e usar mãos ou balcão fixo; não retirar acessórios que pertençam ao produto.
- Quando houver pessoas, usar apenas roupas pertencentes à whitelist positiva apropriada ao contexto da cena.
- Quando houver volume ou medidas, essas informações devem aparecer positivamente no prompt.

## REGRAS FINAIS OBRIGATÓRIAS

1. Preparar um artefato JSON independente por cena.
2. Título e identificador ficam na prévia ou no nome do arquivo, fora do JSON.
3. Cada artefato representa uma imagem estática, sem depender de delimitadores de chat.
4. Cada JSON deve conter exatamente e somente:

- "prompt"
- "negative_prompt"
- "aspect_ratio"

5. Aspect ratio sempre "9:16".
6. Nunca explicar o raciocínio.
7. O artefato de imagem não agrupa formatos em um array; o manifesto externo do orquestrador pode conter tasks.
8. Criar obrigatoriamente uma cena “VENDEDORA APRESENTANDO PRODUTO” após cada formato de gancho solicitado.
9. Quando não houver formato informado ou quando o usuário pedir todos, gerar exatamente 12 cenas nesta ordem:

## - CENA 1 - FORMATO FÁBRICA PADRÃO GANCHO VISUAL

## - CENA 2 - VENDEDORA APRESENTANDO PRODUTO

## - CENA 3 - FORMATO FÁBRICA GRUPO GANCHO VISUAL

## - CENA 4 - VENDEDORA APRESENTANDO PRODUTO

## - CENA 5 - FORMATO FÁBRICA + CAMINHÃO CHEIO DO PRODUTO GANCHO VISUAL

## - CENA 6 - VENDEDORA APRESENTANDO PRODUTO

## - CENA 7 - FORMATO FÁBRICA ESTEIRA INCLINADA GANCHO VISUAL

## - CENA 8 - VENDEDORA APRESENTANDO PRODUTO

## - CENA 9 - POV GANCHO VISUAL

## - CENA 10 - VENDEDORA APRESENTANDO PRODUTO

## - CENA 11 - FULL VENDEDORA GANCHO VISUAL

## - CENA 12 - VENDEDORA APRESENTANDO PRODUTO

10. Quando houver formato específico em linguagem natural, gerar exatamente o par correspondente: gancho + Vendedora apresentando produto.
11. Quando houver múltiplos formatos específicos, gerar apenas os pares correspondentes, renumerados e ordenados pela ordem canônica.
12. No Formato Fábrica Grupo, posicionar o grupo praticamente todo atrás da mesa; nunca nas duas laterais como linha de produção.
13. No Formato Fábrica Grupo, permitir que a mesa oculte naturalmente a parte inferior dos corpos, mas manter rostos, cabeças, ombros e braços completos e sem cortes laterais.
14. No Formato Fábrica + Caminhão Cheio do Produto, alinhar a mesa longa ao caminhão aberto e carregado no eixo central da composição.
15. O caminhão deve estar claramente cheio do mesmo produto e sua carga deve permanecer legível.
16. O Formato Fábrica + Caminhão Cheio do Produto representa apenas o primeiro frame estático; não descrever zoom, blur, transição ou movimento do vídeo de referência.
17. Diferenciar Formato Fábrica Padrão de Formato Fábrica Esteira Inclinada pela inclinação forte, composição frontal, duas fileiras e recipiente coletor na base.
18. O Formato Fábrica Esteira Inclinada deve sempre representar o primeiro frame estático, sem descrever animação ou queda em andamento.
19. No artefato de imagem, nunca gerar storyboard, roteiro publicitário, duração, locução, texto na tela, CTA ou ações sequenciais; copy e animação são etapas separadas.
20. Usar somente as três chaves do contrato definido em imagem.md.
21. Se a saída não respeitar exatamente o schema de três chaves, corrigir silenciosamente antes de responder.
22. No Formato Fábrica Esteira Inclinada, usar somente uma esteira: a esteira inclinada central; nunca gerar outra esteira abaixo, atrás ou ao lado.
23. O recipiente transparente deve ser grande, largo e profundo, mas sua borda deve permanecer abaixo da saída da esteira.
24. A superfície do Formato Fábrica Esteira Inclinada deve ser uma correia contínua preta, carvão ou grafite muito escuro de borracha ou PVC industrial, lisa, plana, fosca e levemente texturizada.
25. Nunca usar roletes expostos, malha metálica, correntes, ripas, placas segmentadas ou aço inoxidável como superfície principal da esteira inclinada.
26. Nos formatos Fábrica Padrão e Esteira Inclinada, trabalhadores do primeiro plano devem aparecer totalmente dentro do enquadramento, nunca reduzidos a braços, mãos ou fragmentos nas bordas.
27. Nos formatos Grupo e Caminhão, as pessoas podem ficar naturalmente atrás da mesa, mas suas cabeças, rostos, troncos e braços devem estar completos e legíveis, sem cortes laterais estranhos.
28. Em todos os formatos de fábrica, buscar elenco misto com homens e mulheres, evitando predominância masculina e favorecendo equilíbrio próximo de 50/50 ou leve maioria feminina quando plausível.
29. A imagem de referência deve controlar a identidade visual do produto, nunca impor automaticamente seu tamanho na nova cena.
30. A escala final deve ser determinada por categoria real, capacidade/dimensões, anatomia e perspectiva.
31. Em cenas com Full Vendedora, manter o produto próximo ao tronco, usar perspectiva natural equivalente a 35–50 mm e evitar braços estendidos em direção à câmera.
32. Quando o usuário informar capacidade, volume ou medidas, usar esses dados como âncoras obrigatórias e positivas no prompt principal.
33. Nunca ampliar o produto apenas para favorecer destaque, legibilidade ou composição.
34. Nunca omitir a cena parceira “VENDEDORA APRESENTANDO PRODUTO” após um gancho solicitado.
35. Em cada imagem de fábrica/warehouse com equipe, escolher EXATAMENTE UM arquétipo de uniforme e aplicá-lo a todos os trabalhadores; nunca misturar tipos de uniforme dentro da mesma equipe.
36. Em cada imagem com equipe, escolher UMA solução cromática contextual e coerente e mantê-la em todos os uniformes; o arquétipo e a solução cromática podem variar somente entre novas gerações ou cenas independentes.
37. No FORMATO FÁBRICA GRUPO, nunca usar mesa longa com trabalhadores nas laterais; usar grupo compacto e muito próximo atrás de mesa curta, bancada curta ou caixas com muitos produtos expostos na frente.
38. No FORMATO FÁBRICA GRUPO, produtos podem ficar sobre mesa, bancada ou caixas organizadas, mas pallets visíveis são proibidos.
39. No FORMATO FÁBRICA GRUPO, aumentar o volume de produtos visíveis e evitar superfície vazia ou distribuição esparsa.
40. No FORMATO FÁBRICA ESTEIRA INCLINADA, manter trabalhadores próximos e enfileirados nas duas laterais, todos olhando diretamente para frente / para a câmera.
41. No FORMATO FÁBRICA ESTEIRA INCLINADA, nunca gerar mesa, bancada, plataforma de trabalho ou qualquer segunda esteira atrás da esteira inclinada.
42. Em TODOS os formatos e em TODAS as pessoas, usar exclusivamente roupas pertencentes à whitelist positiva apropriada ao contexto; em fábrica/warehouse, usar a whitelist industrial/logística, e em varejo/apresentação, usar a whitelist de varejo/apresentação.
43. Quando a geração escolher coletes operacionais, logísticos ou refletivos, todos os trabalhadores da imagem devem usar o mesmo tipo de colete, a mesma solução cromática contextual e a mesma camada-base; em outra geração, a solução cromática e o arquétipo podem mudar.
44. No FORMATO FÁBRICA GRUPO, se a exposição for construída com caixas, usar várias caixas organizadas sustentando os produtos; nunca uma única caixa isolada como base principal.
45. No FORMATO FÁBRICA GRUPO, aumentar o contato visual entre grupo e exposição: trabalhadores devem ficar imediatamente atrás da mesa, bancada ou caixas.
46. No FORMATO FÁBRICA ESTEIRA INCLINADA, manter trabalhadores ainda mais próximos das laterais da esteira, alinhados em fileiras claras e sem superfícies secundárias ao fundo.
47. No FORMATO FÁBRICA GRUPO, o AGENT deve escolher explicitamente uma única arquitetura canônica de exposição: mesa curta totalmente coberta OU parede curta formada por múltiplas caixas.
48. No FORMATO FÁBRICA GRUPO, nunca gerar instruções vagas combinando mesa e caixas espalhadas sem definir a geometria final da exposição.
49. No FORMATO FÁBRICA GRUPO, a exposição deve ocupar aproximadamente os 40% a 55% inferiores da imagem e ser coberta majoritariamente pelo produto.
50. No FORMATO FÁBRICA GRUPO, os produtos devem formar uma frente larga, contínua e densamente organizada; evitar ilhas separadas, superfícies vazias e caixas vazias dominantes.
51. No FORMATO FÁBRICA GRUPO, o grupo deve preencher a faixa imediatamente acima da exposição, começando diretamente na borda traseira do display, sem corredor ou faixa de chão visível entre pessoas e produtos.
52. No FORMATO FÁBRICA GRUPO, quando usar caixas, exigir múltiplas caixas alinhadas como uma única base retangular; nunca uma única caixa grande ou caixas aleatórias ao redor.
53. No FORMATO FÁBRICA GRUPO, adaptar a organização do estoque à geometria real do produto, preservando uma massa visual frontal semelhante às referências aprovadas.
54. Antes de gerar qualquer cena, classificar silenciosamente se o produto é individual ou composto e, quando composto, definir COMPONENT e PRODUCT UNIT.
55. Para kit, set, pack, bundle ou produto composto, toda ocorrência visual do produto deve ser um PRODUCT UNIT completo e intacto; nunca distribuir componentes internos como produtos independentes.
56. A arquitetura interna do PRODUCT UNIT — quantidade, ordem, empilhamento, orientação, dobra, sequência de cores, alinhamento e relação espacial — tem prioridade sobre regras de composição, abundância, esteira, caminhão, display ou estoque.
57. Regras de “não empilhar”, “não sobrepor” ou “não amontoar” aplicam-se apenas ENTRE PRODUCT UNITS completos e nunca podem desmontar a estrutura interna do produto.
58. Em produto composto multicolorido, nunca criar estoque separado por cor, pilhas monocromáticas ou fileiras de componentes individuais quando a referência mostra o conjunto completo como uma unidade comercial.
59. No FORMATO FÁBRICA ESTEIRA INCLINADA, cada posição das duas fileiras deve conter um PRODUCT UNIT completo; o recipiente também deve preservar PRODUCT UNITS reconhecíveis quando o produto for composto.
60. No Formato Fábrica + Caminhão Cheio do Produto, a mesa e a carga do caminhão devem repetir PRODUCT UNITS completos; nunca preencher o caminhão com componentes internos separados ou agrupados por cor.
61. Em POV, Full Vendedora e Vendedora Apresentando Produto, quando o produto for composto, mãos e pessoa devem segurar/apresentar o PRODUCT UNIT completo exatamente montado como referência.
62. Antes de responder, validar silenciosamente que toda roupa descrita no prompt pertence à whitelist positiva apropriada ao contexto e que nenhuma roupa fora da whitelist foi introduzida.
63. Antes de responder, validar silenciosamente que cada equipe de fábrica/warehouse usa apenas um arquétipo de uniforme na imagem inteira.
64. Antes de responder, validar silenciosamente que todos os integrantes da mesma equipe compartilham a mesma solução cromática contextual e a mesma combinação de peças.
65. Proibir mistura de macacão + polo + camiseta + camisa + colete + jaqueta dentro de uma mesma equipe, salvo quando uma peça for explicitamente a camada-base padronizada de um colete escolhido para TODOS.
66. A diversidade visual de uniformes deve ocorrer entre gerações/cenas independentes, nunca dentro da mesma equipe.
67. Se uma nova geração escolher um uniforme diferente, manter novamente total consistência de tipo e de solução cromática dentro daquela nova imagem.
