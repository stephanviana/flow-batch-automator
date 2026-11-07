import { element } from './orders-elements.js';

function copyRequest(parent, label, message) {
  const copy = element(parent, 'button', label, 'secondary');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try {
      await globalThis.navigator.clipboard.writeText(message);
      copy.textContent = 'Copiado. Envie a solicitação no chat.';
    } catch {
      copy.textContent =
        'Não foi possível copiar. Selecione a solicitação abaixo.';
      const text = element(parent, 'textarea', message);
      text.readOnly = true;
      text.setAttribute('aria-label', 'Solicitação para enviar no chat');
      text.select();
    }
  });
}

function closeGroup(parent, dispatch, number, context) {
  const close = element(parent, 'button', 'Encerrar este grupo', 'danger');
  close.type = 'button';
  const feedback = element(parent, 'p', '', 'error');
  feedback.setAttribute('role', 'status');
  close.addEventListener('click', () => {
    void context.action(async () => {
      close.disabled = true;
      feedback.textContent = '';
      try {
        await context.api(
          `/manage/orders/${number}/dispatches/${dispatch.id}/close`,
          {
            reviewHash: dispatch.review.reviewHash,
            preparationHash: dispatch.review.preparationHash,
          },
        );
        await context.refresh();
      } catch (error) {
        feedback.textContent = error.message;
      } finally {
        close.disabled = false;
      }
    });
  });
}

export function dispatchReviewActions(parent, dispatch, number, context) {
  const review = dispatch.review;
  if (!review) return;
  element(parent, 'h4', 'O que fazer agora');
  if (review.canResume) {
    element(
      parent,
      'p',
      `Para tentar novamente, copie a solicitação e envie no chat. A nova tentativa deste grupo pode gerar até ${review.images} imagem(ns) e ${review.videos} vídeo(s).`,
    );
    copyRequest(
      parent,
      'Solicitar nova tentativa no chat',
      `Retome somente o grupo ${dispatch.id} do pedido ${number}, preparação ${review.preparationHash}, revisão ${review.reviewHash}. Autorizo esta nova tentativa de até ${review.images} imagens e ${review.videos} vídeos.`,
    );
  } else {
    element(
      parent,
      'p',
      'A retomada automática deste grupo não está disponível. Confira o diagnóstico e os resultados existentes antes de decidir.',
    );
    copyRequest(
      parent,
      'Pedir ajuda no chat',
      `Revise o despacho ${dispatch.id} do pedido ${number} e explique o próximo passo. Não execute nem retome gerações.`,
    );
  }
  if (review.canClose) closeGroup(parent, dispatch, number, context);
  else
    element(
      parent,
      'p',
      review.closeReason ||
        'Revise os takes pendentes antes de encerrar este grupo.',
    );
}
