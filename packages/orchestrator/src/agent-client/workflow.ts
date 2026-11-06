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
