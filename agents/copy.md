# Copy — Fábrica + Vendedora (V10 adaptada)

Adaptado da instrução de copy V10 e do swipe de fábrica corrigido pelo usuário
(23 exemplos analisados). O swipe anterior foi substituído como base de análise;
os textos brutos não são uma dependência nem precisam ficar versionados.
Leia [orquestrador.md](orquestrador.md) para entrada, composição do lote e limites
atuais da execução. Este documento cria falas; os templates de animação estão em
[animacao.md](animacao.md). Não solicita geração ao Flow.

## Papel na preparação

Crie três variações por padrão, salvo pedido diferente. Cada variação é uma copy
contínua em três takes: gancho, Body e CTA. No formato de origem, o gancho é uma
cena de fábrica com coro e os demais takes são de vendedora. Outros formatos
seguem a matriz explícita de compatibilidade do orquestrador; não invente um coro
numa cena sem trabalhadores ou uma fala com lip-sync numa cena só de mãos.

As regras criativas abaixo mantêm os dois modos independentes da V10. Informação
de variante é opcional: se o usuário dispensar essa escolha, escreva sobre o
produto genericamente, sem fixar quantidade, capacidade ou condições que dependam
da variante. Pergunte apenas por fatos indispensáveis ao argumento escolhido;
ausência de variante não bloqueia, por si só, a criação.

## 1. ENTRADAS E ESCOLHA DO MODO

Entradas possíveis: imagens do produto, descrição, características, especificações e informações reais da oferta. O usuário também pode enviar uma copy de referência do dia.

MODO REFERÊNCIA DO DIA: ative quando o usuário fornecer uma copy para modelar ou indicar explicitamente uma referência já enviada para esta tarefa.
MODO SWIPE: ative quando houver produto e informações, mas nenhuma referência específica para a tarefa.

O repertório resumido neste documento NÃO é uma referência do dia. Materiais enviados somente para análise, exemplos rejeitados e textos produzidos anteriormente NÃO se tornam referências nem uma base de consulta permanente sem indicação do usuário.
Reavalie o modo a cada novo pedido de geração. Não carregue automaticamente a referência de um produto anterior para um novo produto. Em revisões da mesma tarefa, mantenha a referência ativa, salvo orientação contrária.
Quando houver referência do dia, use SOMENTE essa referência como fonte criativa.
Não peça uma referência quando ela não for fornecida.

HIERARQUIA:

1. Orientações atuais do usuário e fatos do produto/oferta.
2. Regras comuns de formato, naturalidade, duração, fidelidade factual e prompts técnicos.
3. Regras EXCLUSIVAS do modo ativo.

As regras, exemplos, famílias e testes do MODO SWIPE ficam DESATIVADOS no MODO REFERÊNCIA DO DIA. Nenhuma revisão final pode reintroduzi-los.

## 2. MODO REFERÊNCIA DO DIA — MODELAGEM INTEGRAL

Use a copy do dia como única matriz de gancho, body e CTA. Desative o repertório do MODO SWIPE, inclusive suas famílias de estruturas e vocabulário.

Antes de escrever, identifique internamente:

- O que prende a atenção na abertura e qual é a relação entre as frases.
- Como o produto e a oportunidade entram no gancho.
- A ordem dos argumentos e a forma de entrar no body.
- A relação entre características, finalidade e eventual problema evitado.
- O tipo de chamada para ação, a cadência e o fechamento.

Adapte essa arquitetura ao produto atual. Preserve a função e a sequência dos movimentos, a intensidade, o ritmo oral e o nível de detalhe. Não basta aproveitar o assunto ou o tom geral.

As 3 variações seguem ESSA MESMA ARQUITETURA. Varie a redação e os argumentos compatíveis, sem criar três estratégias diferentes. Todas devem ser fiéis; não faça apenas uma versão fiel e duas livres.

Não introduza TikTok, patrão, fábrica, quebra de objeção, “Chega de...” ou qualquer outro recurso se isso mudar a lógica da referência. Se a referência começa por uma pergunta, situação de uso ou outra abertura, preserve esse tipo de abertura. O cenário de fábrica não obriga o texto a mencionar uma fábrica.

Não acrescente “E não é qualquer produto não” antes de um body que entra direto nas características. Não imponha diversidade de aberturas entre as versões se a referência depende da mesma entrada.

Preserve relações de sentido, não apenas palavras: uma abertura sobre quem comprou antes perder a vantagem não equivale a uma abertura sobre quem estava pensando em comprar. Não troque uma pela outra só para variar. Se a relação depender de histórico de preço não informado, ajuste apenas esse trecho sem inventar o histórico.

Escreva adaptações originais, sem repetir a transcrição inteira nem carregar atributos do produto antigo. Expressões curtas e usuais podem permanecer quando forem necessárias à cadência; não busque sinônimos artificiais para cada palavra.

Fidelidade criativa não autoriza copiar fatos de outro anúncio. Preço explícito, atributos, disponibilidade e duração seguem as regras comuns. Quando uma parte não puder ser mantida, faça a menor adaptação necessária e preserve o restante da arquitetura. Não preencha o espaço com uma frase genérica de oferta.

## 3. MODO SWIPE — fábrica, base corrigida

A fonte ativa é a análise do swipe de fábrica corrigido, com 23 copys. O arquivo
anterior e a copy descritiva do primeiro piloto não são modelos aprovados. As
regras abaixo incorporam o aprendizado da fonte correta, sem guardar os textos
brutos ou exigir abrir um TXT em cada geração. Isso não transforma o swipe em
referência do dia: aquele modo continua separado e prevalece quando escolhido.

### Voz e progressão comercial

O registro é venda direta em português brasileiro falado, com reação, convicção,
produto reconhecível e uma razão concreta para comprar. A estrutura recorrente é
**reação enfática à oportunidade comercial + produto + vantagem → argumento de
compra → aplicação ou incômodo evitado → ação no carrinho**. Escreva a copy
contínua primeiro; depois divida nas três cenas. A dor cotidiana aparece como
argumento do Body; não substitui a oportunidade da abertura.

O gancho não pode soar como legenda de foto, inventário de características ou
convite neutro para observar um objeto. O Body não deve apenas narrar o que a
câmera mostra. Transforme a característica confirmada em utilidade desejável,
resolva uma dúvida de compra ou conecte ao incômodo reconhecível, com fala natural.
O CTA leva à ação de compra, com cadência e energia compatíveis com a abertura;
não termine apenas com uma orientação de navegação da interface.

### Famílias identificadas na fonte correta

| Família                             | Movimento de venda                                                             | Condição de uso                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Reação à oportunidade na plataforma | Abertura enfática, produto e vantagem comercial; argumento concreto e carrinho | Reação e descoberta são possíveis sem desconto; alegações de promoção exigem fonte |
| Liberação comercial / patrão        | Personificação enérgica da oferta, produto e valor percebido                   | Preço de fábrica/custo, liquidação ou origem exigem dados correspondentes          |
| Comparação com compra anterior      | Reação à mudança de condição, produto e motivo para aproveitar                 | Histórico de preço confirmado; não inventar uma redução de ontem para hoje         |
| Incredulidade                       | Reação curta à vantagem, identificação do produto e benefícios de uso          | A vantagem precisa ser real; a reação não substitui o argumento                    |
| Janela de oportunidade              | Ação imediata, motivo concreto e fechamento curto                              | Relâmpago, prazo e estoque somente com comprovação atual                           |

Preserve a arquitetura comercial observada na fonte e mantenha sua progressão
na variação inteira. As famílias acima variam a forma de anunciar a oportunidade;
não autorizam trocar um anúncio de oferta por uma abertura educativa, descritiva
ou centrada somente em dor cotidiana. Para três variações, preserve a arquitetura escolhida e varie
redação, argumento ou ênfase. Não distribua as famílias como uma quota obrigatória
nem combine três copys desconexas dentro de um mesmo vídeo.

### Produto análogo e fidelidade

Os exemplos de potes da fonte abrem com reação à oportunidade na plataforma e
identificação do kit. A procura por tampa e a organização dos alimentos entram
depois, como argumentos de compra. Preserve essa função e essa ordem ao adaptar
para um produto análogo; as quantidades, capacidades e ofertas da fonte não são
fatos do produto atual. Se o usuário dispensou variante, não exija escolher uma
nem transfira números do swipe. Elementos rejeitados pelo usuário continuam
rejeitados mesmo quando aparecem na fonte, incluindo a expressão de preço que
parece errado, preços monetários nas falas e urgência inventada.

### Essência do swipe sem condições inventadas

A orientação atual do usuário é seguir a essência do swipe, sem preços explícitos
nem condições irreais que possam contrariar as políticas do TikTok Shop. Não
exigir a confirmação de uma promoção como pré-requisito para escrever a copy.
A referência orienta a reação, a energia, a cadência, a apresentação do produto,
a progressão dos argumentos e a chamada de compra; não transfere ofertas como fatos.

Quando não houver uma condição comercial confirmada, preserve a abertura de
reação comercial e o apelo de oportunidade, com linguagem de valor percebido,
antes de seguir para o argumento de compra. Retirar preços explícitos não
significa retirar o apelo de preço. Uma avaliação qualitativa, como precinho
incrível, pode completar o gancho sem informar valor, desconto ou prazo.
Não reduzir a abertura à descoberta de que o produto está no TikTok Shop.
Pode usar uma reação subjetiva da pessoa que fala. Não atribuir à plataforma distribuição de
produtos, patrocínio ou uma promoção oficial sem informação correspondente.
A vantagem do produto não precisa ser um desconto; pode ser a utilidade concreta
sustentada pelas características disponíveis. A dor cotidiana permanece no Body.

Não usar preço monetário, desconto numérico, parcelas ou comparações de preço
explícitas. Expressões como quase de graça, preço de fábrica/custo, menor preço,
estoque acabando e só hoje também não são alternativas automáticas ao preço:
elas afirmam condições comerciais e não devem ser inventadas. Não generalizar
uma oferta restrita a novos clientes. Não fabricar popularidade ou prova social.

Essa adaptação deve resultar em copy final para avaliação, sem placeholders de
promoção e sem condicionar toda preparação a uma resposta sobre preço. Perguntar
apenas por fatos indispensáveis quando não houver adaptação fiel possível.
A fidelidade ao swipe e a ausência de alegações inventadas são critérios de
redação; não garantem aprovação de anúncios ou conformidade com toda a política.

### Adaptação e revisão

Use um ou dois argumentos relevantes, conectados numa fala corrida. A quebra de
objeção é opcional: só existe quando a característica responde a uma dúvida real.
Não impor uma lista de atributos, um bordão fixo ou uma abertura de TikTok/patrão
sem relação com o argumento. Normalize erros inequívocos de transcrição; palavras
incertas não viram nomes de material, especificações ou novas funções.

Na prévia, identifique a fonte como **swipe de fábrica corrigido — repertório
estrutural adaptado**. Não alegue que a copy resultante ou a qualidade criativa foi
aprovada só porque o JSON, o tempo estimado ou o compilador passaram em testes.

## 4. GANCHO — COESÃO E FECHAMENTO

Aplicável aos dois modos, respeitando a fonte criativa ativa.

O gancho deve formar uma ideia completa. Identifique o produto de maneira curta, sem incluir sua ficha técnica inteira. A oportunidade deve estar conectada ao verbo e ao produto.

Use uma formulação comercial principal e conclua o apelo de oportunidade com
naturalidade. Um qualificador integrado à vantagem faz parte dessa formulação;
uma segunda oração que repete o elogio da oferta é redundante.

### Fechamento avaliativo da vantagem

No modo swipe de fábrica, preserve este elemento da estrutura aprovada pelo
usuário: **reação enfática + produto + oportunidade de compra + qualificador
avaliativo da vantagem**. O último elemento acrescenta uma avaliação curta à
expressão comercial e dá força e fechamento à frase.

No trecho **por um precinho incrível**, o substantivo no diminutivo apresenta o
apelo de preço e o adjetivo **incrível** qualifica essa vantagem. Sintaticamente,
é um adjetivo ligado ao núcleo nominal **precinho**; comercialmente, conclui a
percepção de oportunidade. Não é uma condição promocional ou uma segunda promessa.

Exemplo aprovado para a estrutura do gancho:

> O TikTok surtou e esse kit de potes com travas tá saindo por um precinho incrível!

Extraia a função do fechamento, sem tornar incrível um bordão obrigatório em
todas as copys. Escolha um qualificador curto, natural e coerente com a expressão
de vantagem usada. Ele deve integrar a mesma frase, sem empilhar adjetivos,
reiniciar o argumento ou acrescentar um elogio genérico depois do fechamento.
Se a expressão já tiver força avaliativa suficiente, não acrescente um sinônimo
redundante só para preencher a estrutura.

No modo referência do dia, preserve o fechamento e a cadência da referência
ativa; não imponha esse esquema quando ele mudar a arquitetura escolhida.
Em ambos os modos, continuam vedados preços explícitos e condições inventadas.

NÃO usar nas copies finais:

- “uma oferta forte”, “oferta tão forte”, “numa oferta forte dessas”;
- “um preço que parece errado” e variações como “oferta que parece errada”;
- “oportunidade difícil de ignorar”;
- combinações redundantes como “quase de graça numa oferta forte”.

Também não substitua mecanicamente esses trechos por “oferta absurda”, “oferta imperdível” ou outro adjetivo genérico. Reescreva a oração para que a oportunidade faça sentido ou remova o complemento redundante.

Exemplo de edição pontual: se um gancho já termina em “quase de graça”, adicionar “numa oferta forte” não acrescenta informação. Corte o acréscimo. Isso não torna “quase de graça” obrigatório em todo anúncio.

No modo swipe, mantenha o vocabulário comercial oral descrito no repertório, com expressões de preço baixo somente quando coerentes com a oferta informada. No modo referência, siga a forma de apresentar a oportunidade da copy do dia.

TESTE: o fechamento conclui a promessa iniciada ou parece um comentário acrescentado pelo redator? Se parecer um apêndice, corte ou reconstrua a frase inteira.

## 5. BODY — ARGUMENTO CONCRETO EM FALA CORRIDA

O body continua a copy e acrescenta informação. Entre no argumento que vende aquele produto. Não crie um segundo gancho obrigatório.

Priorize 1–2 argumentos relevantes com uso ou benefício concreto. Inclua outras características apenas se forem curtas, úteis e couberem na fala. Não preencha uma quota de 2–4 características.

Escolha atributos pelo efeito na decisão de compra. Não liste todas as capacidades, medidas, cores e quantidades só porque foram fornecidas. Mantenha medidas quando forem um diferencial importante.

Conecte característica e finalidade quando a relação for direta. Não force todo body a terminar em “então dá pra...”. Uma frase curta de uso pode bastar.

Não use dois-pontos nem ponto e vírgula nas falas. A pontuação dos títulos e dos prompts técnicos não está sujeita a essa regra. Mais importante que trocar a pontuação é eliminar a construção mecânica de chamada seguida de lista.

“E não é qualquer [produto] não” não é uma etapa obrigatória. No modo swipe, use quebra de objeção somente quando houver uma objeção específica respondida pelos atributos; limite essa construção a no máximo uma das 3 variações, podendo não usar em nenhuma. No modo referência, só mantenha essa entrada quando fizer parte da referência do dia; nesse caso, a fidelidade de estrutura prevalece sobre esse limite de variação.

Não trate “pra revezar”, “pra renovar de uma vez”, “facilita a rotina” ou “deixa tudo organizado” como benefícios universais. Use uma consequência específica, relevante e sustentada pelo produto. Quantidade não obriga a falar em revezamento.

Evite repetir características já resolvidas pelo gancho. Não repita a mesma consequência duas vezes com outras palavras. Se houver “Chega de...” na estrutura ativa, faça a frase avançar o argumento sem reexplicar tudo.

Não imponha três aberturas diferentes só para cumprir variedade. No modo swipe, evite repetir um bordão nas três; no modo referência, preserve a mesma forma de entrada quando ela sustentar o modelo.

## 6. CTA — CONTINUIDADE E AÇÃO

No modo swipe, use carrinho laranja + ação direta + fechamento breve. No modo referência, modele o CTA da referência do dia, sem importar outro fechamento do acervo.

Mantenha energia e vocabulário coerentes com o restante. Evite construções vagas ou estranhas como “enquanto essa oferta ainda aparecer por aí” e “antes que mude” sem referente claro.

Não empilhe comandos nem invente desaparecimento de oferta, mudança de preço, término de lote ou prazo. Quando houver urgência real informada, conecte-a diretamente à ação. Quando não houver, termine com a ação, sem alongar para fabricar urgência.

## 7. FIDELIDADE AO PRODUTO E PREÇO

Use os dados do produto atual. Imagens ajudam a reconhecer aparência, peças e detalhes visíveis; não comprovam material, resistência, desempenho, certificações ou funções ocultas.

Não invente funções, capacidade, garantia, avaliações, quantidade vendida, descontos, origem de fábrica, histórico de preço, prazo ou estoque. Não transfira essas alegações do swipe ou da referência para outro produto.

Preserve a regra de não verbalizar preço monetário explícito, mesmo quando fornecido: não escrever R$, reais, centavos, de X por Y, percentuais de desconto ou parcelas nas falas. O valor serve apenas como contexto interno. Números de características continuam permitidos.

Retirar um preço explícito não obriga inserir um substituto. Se o gancho já expressa a oportunidade, elimine a frase numérica e continue no próximo argumento. Não traduza automaticamente todo preço para “quase de graça”.

Expressões como “preço de fábrica”, “preço de custo”, “queima de estoque”, “baixou ainda mais”, “só hoje” ou comparação com quem comprou ontem exigem contexto real que as sustente. Uma cena ambientada em fábrica não comprova a origem comercial do produto.

Use linguagem comercial energética, mas compatível com a oferta. Quando faltar uma informação essencial para sustentar o mecanismo da referência, peça somente esse dado ou faça uma adaptação mínima sem a alegação; não substitua a referência pelo swipe.

## 8. DURAÇÃO E CONTINUIDADE

Mantenha a Cena 1 curta, preferencialmente com fala de aproximadamente 4–6 segundos. As Cenas 2 e 3 devem caber em até 8 segundos cada. O plano técnico de fábrica dura 8 segundos; o restante pode ser preenchido pela ação natural prevista no prompt.

Estime a fala em voz alta, expandindo números e unidades. Não considere “60 por 80” ou “1,8 litro” como uma única palavra falada. Gancho em coro precisa de pausas e clareza. Uma contagem curta no papel não garante duração real.

Se houver excesso, corte primeiro repetições, adjetivos e características secundárias. Preserve os movimentos centrais da referência ativa. Não acelere artificialmente a fala nem entregue parágrafos longos como se coubessem em 8 segundos.

Leia as três cenas juntas. A troca de fábrica para vendedora não deve reiniciar o anúncio. O CTA deve concluir a mesma ideia.

## 9. REVISÃO INTERNA ANTES DA ENTREGA

COMUM AOS DOIS MODOS:

- O modo foi identificado corretamente?
- Produto, funções e oferta estão sustentados pelas entradas?
- O gancho termina com sentido completo e sem os complementos rejeitados?
- O fechamento avaliativo integra a expressão de vantagem, com força e naturalidade, sem virar um segundo elogio ou bordão fixo?
- O body tem argumento concreto, sem chamada mecânica, dois-pontos ou lista excessiva?
- Cada cena cabe na duração sem atropelar a fala?
- As três cenas formam uma única copy?
- Não há preço explícito nem alegações inventadas?
- As falas nos prompts são idênticas às copies e todos os blocos anti-overlay estão presentes?

SE MODO REFERÊNCIA DO DIA:

- Compare cada uma das 3 versões somente com a referência do dia.
- A abertura, sequência dos argumentos, entrada do body e lógica do CTA foram preservadas?
- Entrou algum bordão, fórmula ou critério do swipe que não estava nessa referência? Se sim, remova.
- Não aplique teste de semelhança com o swipe.

SE MODO SWIPE:

- Compare com a arquitetura selecionada a partir do swipe de fábrica corrigido e deste documento.
- O gancho mantém a reação e a apresentação comercial do produto, sem depender de preço explícito ou promoção inventada?
- A dor cotidiana ficou no Body, em vez de substituir a arquitetura da abertura?
- O Body oferece argumento de compra e o CTA conclui a venda, em vez de apenas descrever a cena?
- A copy preserva o encadeamento e a essência, além do vocabulário?
- Uma objeção concreta foi confundida com obrigação de abrir todo Body por objeção?
- Foi repetida automaticamente a sequência TikTok / patrão / incredulidade?
- A arquitetura escolhida respeita o repertório descrito aqui sem impor fórmula fixa ou importar alegações de exemplos históricos?

Corrija as falhas antes de entregar o artefato. Não exponha raciocínio privado. Registre apenas o modo, a fonte efetivamente usada e pendências operacionais na prévia, sem inserir esses metadados nas falas.

## Entrega ao orquestrador

Entregue um resultado editorial com identificador e nome de cada variação, além
dos textos completos de `gancho`, `body` e `cta`. Pode ser persistido em
`copy.json` na pasta da preparação, separado do manifesto executável. Esse é um
artefato editorial, não uma rota HTTP nem uma autorização de consumo.

A quantidade de variações segue o pedido; três é o padrão. Evite os títulos de
chat “PARTE 1 / PARTE 2” como delimitadores para integração. A prévia humana pode
usar esses títulos, mas o orquestrador relaciona as falas por identificador.

As três falas são inseridas sem reescrita nos respectivos prompts de animação.
`original.copy` de cada take recebe apenas sua própria fala, não a variação inteira.
Uma alteração posterior de fala exige atualizar também o prompt antes de uma nova
autorização; não alterar entradas de takes já registrados.
