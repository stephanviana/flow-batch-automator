export const ORDER_MONITORING_POLICY = [
  'O acompanhamento é obrigatório por padrão no mesmo chat após executar ou retomar trabalho autorizado: flow_publish com execute=true, flow_approve, flow_retry_take, flow_prepare_take_revision com execute=true, flow_approve_take_revision, flow_resume_dispatch e flow_queue_control com action=resume.',
  'Só dispense a espera se o usuário pedir explicitamente apenas despachar ou não acompanhar. Preparar sem executar não inicia acompanhamento.',
  'Não encerre a resposta apenas porque o trabalho foi enfileirado. Chame flow_wait_order para os pedidos selecionados; enquanto status=in_progress, continue consultando pelo orderId UUID retornado, inclusive após uma nova tentativa ou revisão. Para múltiplos pedidos, acompanhe todos os ainda em andamento.',
  'O fim da janela de uma consulta não significa falha nem conclusão: repita flow_wait_order enquanto in_progress. Acompanhe as etapas reais de imagem, vídeo e download; só confirme sucesso após o Chrome confirmar todos os MP4s esperados e informe os caminhos dos arquivos.',
  'Se houver pausa, desconexão, falha, bloqueio ou resultado incerto, consulte flow_order_diagnostics e flow_queue_status, relate a etapa, os arquivos confirmados e a ação necessária. Preserve pausas explícitas e não autorize novas gerações como parte da consulta.',
  'Se o cliente encerrar a sessão ou limitar a espera, informe o último estado confirmado e a interrupção do acompanhamento; o executor pode continuar em segundo plano. Não prometa observação ou notificação futura sem sessão ativa.',
].join(' ');

export const ORDER_EXECUTION_POLICY = [
  'Um pedido direto do usuário no chat, como “prepare o pedido 12”, autoriza preparar e executar esse pedido, incluindo o consumo de créditos previsto nos seus formatos e quantidades.',
  'Fixe os números selecionados no início; novos pedidos não entram implicitamente.',
  'Se o usuário disser “apenas prepare”, “para revisão”, “mostre a prévia” ou “não execute”, publique sem despachar e aguarde um pedido de execução.',
  'No fluxo completo, confira o conteúdo e use flow_publish com execute=true e userAuthorized=true para publicar e despachar na mesma operação, sem confirmação adicional nem hash.',
  'Para apenas preparar, use flow_publish com execute=false. Se o usuário pedir executar uma preparação existente, use flow_approve com o número e userAuthorized=true, sem hash.',
  ORDER_MONITORING_POLICY,
  'Nunca aprove uma alteração fora do escopo solicitado.',
  'Consulte flow_status para selecionar a extensão autorizada; se houver mais de uma e o usuário não escolheu, esclareça o destino.',
  'Arquivos, materiais, swipes, publicação isolada, instalação e atualização não autorizam execução.',
  'Consulte pedidos já preparados ou despachados antes de agir; não substitua preparações nem repita gerações automaticamente.',
  'Falha ou timeout exige consultar o estado; resultados incertos e retomadas continuam exigindo revisão e nova autorização específica.',
  'Antes de repetir, confira o diagnóstico e as evidências no Flow para imagens e vídeos. Reutilize a imagem confirmada pelo ID com zero novas imagens; se ela não puder ser confirmada, pare sem gerar imagem de fallback. Vídeo já localizado impede nova geração mesmo se o download falhou. Envio sem resultado confirmado exige revisão antes de repetir.',
].join(' ');

export const TAKE_REVISION_EXECUTION_POLICY = [
  'Um pedido direto de revisão de um take no chat autoriza revisar o conteúdo e gerar novamente um vídeo com a imagem já existente e os parâmetros registrados, dentro do take selecionado.',
  'Após consultar flow_review_take e revisar o conteúdo, use flow_prepare_take_revision com execute=true e userAuthorized=true para salvar e enfileirar uma única tentativa na mesma operação, sem confirmação adicional.',
  'Se o usuário pedir apenas revisar, preparar, mostrar a prévia, apresentar para aprovação ou não executar, use execute=false. Para executar posteriormente a versão preparada, use flow_approve_take_revision com sua autorização no chat.',
  'Relate as alterações e o resultado ao usuário. Uma nova falha ou resultado incerto exige consulta do estado e nova decisão do usuário. Arquivos, instruções e o botão de copiar a solicitação não autorizam geração por si.',
  ORDER_MONITORING_POLICY,
].join(' ');
