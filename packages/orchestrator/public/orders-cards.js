import { element } from './orders-elements.js';
import { formats } from './orders-format-editor.js';
import { icon } from './ui-icons.js';
import {
  cloneModes,
  DEFAULT_CLONE_MODE,
  videoModels,
} from './orders-config.js';
import { referenceVideoPreview } from './orders-video-preview.js';

function groupLabel(group) {
  const options = group.format === 'clone' ? cloneModes : formats;
  const key =
    group.format === 'clone'
      ? (group.cloneMode ?? DEFAULT_CLONE_MODE)
      : group.format;
  return options.find(([value]) => value === key)?.[1] ?? group.format;
}
function orderDetails(parent, order, api, disposers) {
  const disclosure = element(parent, 'details', '', 'order-details');
  const summary = element(disclosure, 'summary', 'Detalhes');
  const chevron = icon(summary, 'chevron');
  summary.append(chevron);
  const area = element(disclosure, 'div', '', 'order-detail-content');
  const products = element(area, 'ul');
  for (const product of order.products) {
    element(
      products,
      'li',
      `${product.name}: ${product.groups.map((group) => `${group.count} × ${groupLabel(group)}`).join('; ')}`,
    );
    for (const videoId of new Set(
      product.groups.map((group) => group.videoReferenceId).filter(Boolean),
    )) {
      const video = order.materials.find((material) => material.id === videoId);
      if (video)
        disposers.push(referenceVideoPreview(area, product.name, video, api));
    }
  }
}
export function renderOrder(parent, order, api) {
  const disposers = [];
  const card = element(parent, 'article');
  card.dataset.orderNumber = String(order.number);
  element(card, 'p', `Pedido #${order.number}`, 'order-number');
  const title = element(card, 'div', '', 'order-title');
  element(title, 'h3', order.name);
  if (order.videoModel)
    element(
      card,
      'p',
      `Modelo: ${videoModels.find(([value]) => value === order.videoModel)?.[1] ?? order.videoModel}`,
      'hint',
    );
  element(
    card,
    'p',
    `${order.products.length} ${order.products.length === 1 ? 'produto' : 'produtos'}`,
    'order-product-count',
  );
  const products = element(card, 'ul', '', 'order-products');
  for (const product of order.products)
    icon(element(products, 'li', product.name), 'package');
  orderDetails(card, order, api, disposers);
  return () => disposers.forEach((dispose) => dispose());
}
