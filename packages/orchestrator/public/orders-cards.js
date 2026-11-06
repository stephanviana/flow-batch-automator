import { element } from './orders-elements.js';
import { formats } from './orders-format-editor.js';
import { icon } from './ui-icons.js';
import { referenceVideoPreview } from './orders-video-preview.js';

const states = {
  'awaiting-preparation': 'Aguardando preparação',
  preparing: 'Em preparação',
  prepared: 'Prévia pronta · aguarda autorização no chat',
  dispatched: 'Em execução',
  completed: 'Concluído',
  failed: 'Encerrado com falha',
  uncertain: 'Resultado incerto · requer revisão',
  blocked: 'Despacho bloqueado · requer revisão',
  cancelled: 'Cancelado',
};
function details(parent, title, value) {
  const node = element(parent, 'details');
  element(node, 'summary', title);
  element(node, 'pre', value);
}
function cloneReview(parent, variation) {
  const review = element(parent, 'details');
  element(
    review,
    'summary',
    `${variation.name} · análise e adaptação do vídeo`,
  );
  element(review, 'p', variation.cloneVideo.analysis);
  for (const [stage, label] of [
    ['hook', 'Gancho'],
    ['body', 'Body'],
    ['cta', 'CTA'],
  ]) {
    element(review, 'h4', label);
    element(review, 'pre', variation.cloneVideo.directions[stage]);
  }
}
function generationCounts(parent, count) {
  element(parent, 'p', 'Limite de geração', 'generation-title');
  const counts = element(parent, 'div', '', 'generation-counts');
  icon(
    element(
      counts,
      'span',
      `${count.images} ${count.images === 1 ? 'imagem' : 'imagens'}`,
    ),
    'image',
  );
  icon(
    element(
      counts,
      'span',
      `${count.videos} ${count.videos === 1 ? 'vídeo' : 'vídeos'}`,
    ),
    'video',
  );
}
function preparationPreview(parent, order, { api, report }) {
  const preview = element(parent, 'button', 'Ver prévia', 'secondary');
  preview.type = 'button';
  preview.addEventListener('click', async () => {
    preview.disabled = true;
    try {
      const { order: current } = await api(`/manage/orders/${order.number}`);
      const area = element(
        parent.parentElement,
        'div',
        '',
        'preparation-preview',
      );
      for (const prepared of current.preparation.products) {
        const product = current.products.find(
          (product) => product.id === prepared.id,
        );
        for (const variation of prepared.variations) {
          if (variation.cloneVideo) cloneReview(area, variation);
          details(
            area,
            `${product.name} · ${variation.name} · falas`,
            JSON.stringify(variation.copy, null, 2),
          );
          details(
            area,
            `${variation.name} · imagens`,
            JSON.stringify(
              variation.presenterImage
                ? {
                    gancho: variation.hookImage,
                    vendedora: variation.presenterImage,
                  }
                : { 'gancho, Body e CTA': variation.hookImage },
              null,
              2,
            ),
          );
        }
      }
      details(
        area,
        'Manifestos e parâmetros de vídeo',
        JSON.stringify(current.preparation.manifests, null, 2),
      );
      preview.remove();
    } catch (error) {
      preview.disabled = false;
      report(error);
    }
  });
}
function orderDetails(parent, order, context, disposers) {
  const disclosure = element(parent, 'details', '', 'order-details');
  const summary = element(disclosure, 'summary', 'Detalhes');
  const chevron = icon(summary, 'chevron');
  summary.append(chevron);
  const area = element(disclosure, 'div', '', 'order-detail-content');
  element(area, 'p', states[order.state]);
  const products = element(area, 'ul');
  for (const product of order.products) {
    element(
      products,
      'li',
      `${product.name}: ${product.groups.map((group) => `${group.count} × ${formats.find(([key]) => key === group.format)?.[1]}`).join('; ')}`,
    );
    for (const videoId of new Set(
      product.groups.map((group) => group.videoReferenceId).filter(Boolean),
    )) {
      const video = order.materials.find((material) => material.id === videoId);
      if (video)
        disposers.push(
          referenceVideoPreview(area, product.name, video, context.api),
        );
    }
  }
  if (Object.keys(order.counts).length)
    element(
      area,
      'p',
      Object.entries(order.counts)
        .map(([key, count]) => `${count} ${key}`)
        .join(' · '),
    );
  if (['awaiting-preparation', 'prepared'].includes(order.state)) {
    const cancel = element(area, 'button', 'Cancelar pedido', 'danger');
    cancel.type = 'button';
    cancel.addEventListener(
      'click',
      () =>
        void context.action(async () => {
          cancel.disabled = true;
          try {
            await context.api(`/manage/orders/${order.id}/cancel`, {});
            context.onCancel();
            await context.refresh();
          } finally {
            cancel.disabled = false;
          }
        }),
    );
  }
}
export function renderOrder(parent, order, context) {
  const card = element(parent, 'article');
  card.dataset.orderNumber = String(order.number);
  card.dataset.state = order.state;
  element(card, 'p', `Pedido #${order.number}`, 'order-number');
  const title = element(card, 'div', '', 'order-title');
  element(title, 'h3', order.name);
  const review = ['uncertain', 'blocked'].includes(order.state);
  const badge = element(
    title,
    'span',
    review
      ? 'Requer revisão'
      : order.state === 'prepared'
        ? 'Prévia pronta'
        : states[order.state],
    'badge',
  );
  badge.title = states[order.state];
  element(
    card,
    'p',
    `${order.products.length} ${order.products.length === 1 ? 'produto' : 'produtos'}`,
    'order-product-count',
  );
  const products = element(card, 'ul', '', 'order-products');
  for (const product of order.products)
    icon(element(products, 'li', product.name), 'package');
  if (order.lease)
    element(
      card,
      'p',
      `Preparando: ${order.lease.worker} · reserva até ${new Date(order.lease.expiresAt).toLocaleTimeString()}`,
      'hint',
    );
  for (const dispatch of order.dispatches) {
    if (!dispatch.message) continue;
    const warning = ['blocked', 'uncertain', 'failed'].includes(dispatch.state);
    icon(
      element(
        card,
        'p',
        dispatch.message,
        warning ? 'order-notice' : 'order-notice notice-info',
      ),
      warning ? 'warning' : 'message',
    );
  }
  if (order.preparationHash) generationCounts(card, order.generationCounts);
  if (order.materials.some((material) => !material.available))
    element(
      card,
      'p',
      'As cópias dos materiais deste pedido foram removidas. O histórico foi mantido.',
      'hint',
    );
  const actions = element(card, 'div', '', 'order-actions');
  if (order.preparationHash) preparationPreview(actions, order, context);
  const disposers = [];
  orderDetails(card, order, context, disposers);
  return () => disposers.forEach((dispose) => dispose());
}
