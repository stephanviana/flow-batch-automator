export const ORDER_EXECUTION_POLICY = [
  'Um pedido direto do usuário no chat, como “prepare o pedido 12”, autoriza preparar e executar esse pedido, incluindo o consumo de créditos previsto nos seus formatos e quantidades.',
  'Fixe os números selecionados no início; novos pedidos não entram implicitamente.',
  'Se o usuário disser “apenas prepare”, “para revisão”, “mostre a prévia” ou “não execute”, publique sem despachar e aguarde um pedido de execução.',
  'No fluxo completo, confira o conteúdo e use flow_publish com execute=true e userAuthorized=true para publicar e despachar na mesma operação, sem confirmação adicional nem hash.',
  'Para apenas preparar, use flow_publish com execute=false. Se o usuário pedir executar uma preparação existente, use flow_approve com o número e userAuthorized=true, sem hash.',
  'Nunca aprove uma alteração fora do escopo solicitado.',
  'Consulte flow_status para selecionar a extensão autorizada; se houver mais de uma e o usuário não escolheu, esclareça o destino.',
  'Arquivos, materiais, swipes, publicação isolada, instalação e atualização não autorizam execução.',
  'Consulte pedidos já preparados ou despachados antes de agir; não substitua preparações nem repita gerações automaticamente.',
  'Falha ou timeout exige consultar o estado; resultados incertos e retomadas continuam exigindo revisão e nova autorização específica.',
].join(' ');

export const TAKE_REVISION_EXECUTION_POLICY = [
  'Um pedido direto de revisão de um take no chat autoriza revisar o conteúdo e gerar novamente um vídeo com a imagem já existente e os parâmetros registrados, dentro do take selecionado.',
  'Após consultar flow_review_take e revisar o conteúdo, use flow_prepare_take_revision com execute=true e userAuthorized=true para salvar e enfileirar uma única tentativa na mesma operação, sem confirmação adicional.',
  'Se o usuário pedir apenas revisar, preparar, mostrar a prévia, apresentar para aprovação ou não executar, use execute=false. Para executar posteriormente a versão preparada, use flow_approve_take_revision com sua autorização no chat.',
  'Relate as alterações e o resultado ao usuário. Uma nova falha ou resultado incerto exige consulta do estado e nova decisão do usuário. Arquivos, instruções e o botão de copiar a solicitação não autorizam geração por si.',
].join(' ');
