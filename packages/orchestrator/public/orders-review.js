import { element } from './orders-elements.js';

const states = {
  queued: 'Pendente',
  dispatching: 'Enviando',
  submitted: 'Envio confirmado',
  generating: 'Gerando',
  download_pending: 'Baixando MP4',
  completed: 'Concluído',
  failed: 'Falha',
  uncertain: 'Resultado incerto',
  cancelled: 'Cancelado',
  pending: 'Aguardando a extensão',
  blocked: 'Bloqueado',
};
const stages = {
  'project-preparation': 'Preparação do projeto',
  'project-creation': 'Criação do projeto',
  reference_uploaded: 'Referência enviada',
  image_generated: 'Imagem gerada',
  image_reused: 'Imagem reutilizada',
  video_submitted: 'Vídeo enviado',
  video_ready: 'Vídeo localizado',
  download_started: 'Download iniciado',
};
const failureCauses = {
  project_locate_tab_failed:
    'A extensão não conseguiu localizar uma aba utilizável do Flow.',
  project_navigate_failed:
    'A extensão não conseguiu abrir a página do Flow para preparar o projeto.',
  project_wait_ready_failed:
    'A página do Flow não ficou pronta para uso. Confira o login e se a página terminou de carregar.',
  flow_project_creation_unknown:
    'A criação foi solicitada, mas o Flow não confirmou o resultado. Confira os projetos existentes antes de qualquer retomada.',
  invalid_project_id:
    'O Flow respondeu sem uma identificação válida do projeto. O resultado da criação precisa ser conferido.',
};
const reasons = {
  enqueued: 'Take registrado na fila',
  'dispatch-intent-persisted': 'Intenção de envio registrada',
  'executor-progress': 'Andamento confirmado pela extensão',
  'executor-failed': 'Falha informada pela extensão',
  'executor-outcome-unknown': 'A extensão não confirmou o resultado',
  'server-restart': 'Servidor reiniciado durante a tentativa',
  'connection-lost': 'Conexão com a extensão interrompida',
  'attempt-timeout': 'Prazo de resposta esgotado',
  'dispatch-outcome-unknown': 'O envio não foi confirmado',
};

function dispatchReview(parent, dispatch, orderNumber) {
  const section = element(parent, 'section', '', 'diagnostic-section');
  element(
    section,
    'h4',
    `Envio do grupo · ${states[dispatch.state] ?? dispatch.state}`,
  );
  element(
    section,
    'p',
    dispatch.message || 'Nenhuma mensagem de envio registrada.',
  );
  const review = dispatch.review;
  if (review) {
    if (review.failure) {
      if (failureCauses[review.failure.code])
        element(section, 'p', failureCauses[review.failure.code]);
      element(
        section,
        'p',
        `${stages[review.failure.stage] ?? review.failure.stage} · ${review.failure.code}`,
      );
      element(
        section,
        'p',
        review.failure.sent
          ? 'Houve envio da solicitação; confira o resultado no Flow.'
          : 'A falha foi registrada antes do envio da solicitação.',
      );
    } else
      element(
        section,
        'p',
        'A etapa exata da falha não foi registrada neste despacho.',
      );
    element(section, 'p', review.reason);
    if (review.canResume)
      element(
        section,
        'p',
        'A retomada deste grupo exige nova autorização explícita no chat.',
      );
  }
  const copy = element(
    section,
    'button',
    'Copiar pedido de análise',
    'secondary',
  );
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try {
      await globalThis.navigator.clipboard.writeText(
        `Revise o despacho ${dispatch.id} do pedido ${orderNumber}, explique o motivo do bloqueio e o próximo passo. Não execute nem retome gerações.`,
      );
      copy.textContent = 'Pedido de análise copiado';
    } catch {
      copy.textContent = 'Não foi possível copiar. Consulte o grupo abaixo.';
    }
  });
  element(section, 'p', `Grupo: ${dispatch.id}`, 'hint');
}

function taskReview(parent, diagnostic) {
  const { task, events, checkpoints, projectId } = diagnostic;
  const details = element(parent, 'details', '', 'diagnostic-task');
  element(
    details,
    'summary',
    `${task.product} · ${task.video} · ${task.take} · ${states[task.state] ?? task.state}`,
  );
  if (task.lastError)
    element(
      details,
      'p',
      `${task.lastError.message} (${task.lastError.code})`,
      'error',
    );
  if (task.state === 'uncertain') {
    details.open = true;
    element(
      details,
      'p',
      'Confira o projeto e os downloads. Na extensão, use Revisar take para registrar o resultado observado; a revisão não reenvia a geração.',
    );
  }
  if (projectId) {
    const link = element(details, 'a', 'Conferir projeto no Flow');
    link.href = `https://flow.google.com/project/${encodeURIComponent(projectId)}`;
    link.target = 'flow-batch-review';
    link.rel = 'noopener';
  }
  element(
    details,
    'p',
    `Última etapa confirmada: ${stages[task.step] ?? 'nenhum checkpoint registrado'}. Tentativas: ${task.attemptCount}/${task.maxAttempts}.`,
  );
  const history = element(details, 'ol');
  for (const event of events)
    element(
      history,
      'li',
      `${new Date(event.at).toLocaleString('pt-BR')} · ${states[event.state] ?? event.state} · ${reasons[event.reason] ?? event.reason}${event.error ? ` · ${event.error.message} (${event.error.code})` : ''}`,
    );
  if (checkpoints.length)
    element(
      details,
      'p',
      `Etapas confirmadas: ${checkpoints.map(({ stage }) => stages[stage] ?? stage).join(' → ')}`,
    );
}

function renderDiagnostic(parent, diagnostic) {
  parent.replaceChildren();
  element(parent, 'h4', 'Preparação');
  element(parent, 'p', diagnostic.preparation.message);
  if (diagnostic.unavailableMaterials.length)
    element(
      parent,
      'p',
      `Materiais indisponíveis: ${diagnostic.unavailableMaterials.join(', ')}.`,
      'error',
    );
  if (!diagnostic.dispatches.length)
    element(
      parent,
      'p',
      diagnostic.state === 'cancelled'
        ? 'Pedido cancelado. Nenhum envio será realizado.'
        : diagnostic.preparation.published
          ? 'A preparação está pronta, mas nenhum envio foi autorizado. Solicite a execução no chat.'
          : 'Sem preparação publicada, nenhum envio de geração foi registrado.',
    );
  for (const dispatch of diagnostic.dispatches)
    dispatchReview(parent, dispatch, diagnostic.number);
  element(parent, 'h4', 'Gerações');
  if (!diagnostic.tasks.length)
    element(
      parent,
      'p',
      'Nenhum take foi registrado na fila para este pedido.',
    );
  for (const task of diagnostic.tasks) taskReview(parent, task);
}

export function orderReview(parent, order, context) {
  const { api, report } = context;
  const button = element(
    parent,
    'button',
    ['blocked', 'uncertain'].includes(order.state)
      ? 'Revisar pedido'
      : 'Ver diagnóstico',
    'secondary',
  );
  button.type = 'button';
  let review;
  const load = async () => {
    button.disabled = true;
    try {
      const diagnostic = await api(
        `/manage/orders/${order.number}/diagnostics`,
      );
      if (!review) {
        review = element(parent.parentElement, 'details', '', 'order-review');
        element(review, 'summary', `Diagnóstico do pedido #${order.number}`);
        element(review, 'div', '', 'order-review-content');
        const update = element(
          review,
          'button',
          'Atualizar diagnóstico',
          'secondary',
        );
        update.type = 'button';
        update.addEventListener('click', () => {
          if (!button.disabled) void load();
        });
      }
      review.open = true;
      renderDiagnostic(
        review.querySelector('.order-review-content'),
        diagnostic,
      );
      review.scrollIntoView({ block: 'nearest' });
    } catch (error) {
      report(error);
    } finally {
      button.disabled = false;
    }
  };
  button.addEventListener('click', () => {
    void load();
  });
  return load;
}
