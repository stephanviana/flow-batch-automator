import { api } from './management-api.js';
export { api };
import { element, productEditor } from './orders-editor.js';
import { canClearOrder } from './orders-cleanup.js';
import { renderOrder } from './orders-cards.js';
import { icon } from './ui-icons.js';
import { videoModels, DEFAULT_ORDER_VIDEO_MODEL } from './orders-config.js';
for (const node of document.querySelectorAll('[data-icon]'))
  icon(node, node.dataset.icon);
const status = document.querySelector('#status'),
  form = document.querySelector('#order-form');
for (const [value, title] of videoModels) {
  const option = element(form.elements.videoModel, 'option', title);
  option.value = value;
  option.defaultSelected = value === DEFAULT_ORDER_VIDEO_MODEL;
}
const products = [],
  container = document.querySelector('#products');
const previewDisposers = [];
let savedOrders = [];
let draftId = crypto.randomUUID(),
  busy = false;
function addProduct() {
  const editor = productEditor(container);
  products.push(editor);
  editor.remove.addEventListener('click', () => {
    products.splice(products.indexOf(editor), 1);
    editor.dispose();
    editor.container.remove();
    updateProductCount();
  });
  updateProductCount();
}
function updateProductCount() {
  products.forEach((product, index) => product.renumber(index + 1));
  document.querySelector('#product-count').textContent =
    `${products.length} ${products.length === 1 ? 'produto' : 'produtos'}`;
}
function report(error, source = 'action') {
  status.textContent = error.message;
  status.className = 'error';
  status.dataset.errorSource = source;
}
async function action(operation) {
  if (busy) return;
  busy = true;
  const controls = [
    ...form.querySelectorAll('button,input,select,textarea'),
  ].map((control) => ({ control, disabled: control.disabled }));
  controls.forEach(({ control }) => (control.disabled = true));
  status.className = '';
  delete status.dataset.errorSource;
  try {
    await operation();
  } catch (error) {
    report(error);
  } finally {
    controls.forEach(({ control, disabled }) => (control.disabled = disabled));
    busy = false;
  }
}
document.querySelector('#add-product').addEventListener('click', addProduct);
addProduct();
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void action(async () => {
    if (!products.length) throw new Error('Adicione pelo menos um produto.');
    status.textContent = 'Importando os materiais e salvando o pedido…';
    const selection = [];
    for (const product of products) selection.push(await product.read(api));
    const order = await api('/manage/orders', {
      id: draftId,
      name: form.elements.orderName.value,
      products: selection,
      videoModel: form.elements.videoModel.value,
    });
    status.textContent = `Pedido ${order.number} salvo. Peça ao agente: “Prepare o pedido ${order.number}”.`;
    draftId = crypto.randomUUID();
    products.forEach((product) => product.dispose());
    container.replaceChildren();
    products.length = 0;
    form.reset();
    addProduct();
    await refresh();
  });
});
function renderSavedOrders() {
  const orders = savedOrders;
  const list = document.querySelector('#orders');
  document.querySelector('#clear-unsent-orders').disabled =
    !orders.some(canClearOrder);
  previewDisposers.splice(0).forEach((dispose) => dispose());
  list.replaceChildren();
  for (const order of orders) {
    previewDisposers.push(
      renderOrder(list, order, {
        api,
        report,
        action,
        refresh,
        onClear() {
          clearOrders([order]);
        },
        onCancel() {
          status.textContent = `Pedido ${order.number} cancelado.`;
        },
      }),
    );
  }
  if (!orders.length)
    element(list, 'p', 'Nenhum pedido salvo. O próximo pedido começa em #1.');
}
function clearOrders(orders) {
  void action(async () => {
    const ids = orders.filter(canClearOrder).map((order) => order.id);
    if (!ids.length) return;
    const result = await api('/manage/orders/clear', { ids });
    await refresh();
    document.querySelector('#orders-cleanup-feedback').textContent =
      `${result.cleared} ${result.cleared === 1 ? 'pedido removido' : 'pedidos removidos'} da lista. Próximo pedido: #${result.nextNumber}.`;
  });
}
document
  .querySelector('#clear-unsent-orders')
  .addEventListener('click', () => clearOrders(savedOrders));
async function refresh() {
  const { orders } = await api('/manage/orders');
  savedOrders = orders;
  renderSavedOrders();
  if (status.dataset.errorSource === 'refresh') {
    status.textContent = '';
    status.className = '';
    delete status.dataset.errorSource;
  }
}
function refreshOrders() {
  void refresh().catch((error) => report(error, 'refresh'));
}
document.querySelector('#refresh').addEventListener('click', refreshOrders);
document.querySelector('#preview-cleanup').addEventListener(
  'click',
  () =>
    void action(async () => {
      const toggle = document.querySelector('#preview-cleanup');
      const panel = document.querySelector('#storage-details');
      const expanded = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(expanded));
      panel.hidden = !expanded;
      if (!expanded) return;
      const result = await api('/manage/cleanup'),
        area = document.querySelector('#cleanup');
      area.replaceChildren();
      element(
        area,
        'p',
        `${result.materials.length} arquivos elegíveis · ${(result.bytes / 1024 / 1024).toFixed(1)} MB.`,
      );
      const list = element(area, 'ul');
      for (const material of result.materials)
        element(list, 'li', material.name);
      if (result.materials.length) {
        const remove = element(
          area,
          'button',
          'Remover estas cópias importadas',
          'danger',
        );
        remove.addEventListener(
          'click',
          () =>
            void action(async () => {
              remove.disabled = true;
              const cleaned = await api('/manage/cleanup', {
                ids: result.materials.map((material) => material.id),
              });
              area.replaceChildren();
              element(area, 'p', `${cleaned.removed} cópias removidas.`);
              await refresh();
            }),
        );
      }
    }),
);
refreshOrders();
setInterval(() => {
  if (
    !document.hidden &&
    !busy &&
    !document.querySelector('#orders details[open]')
  )
    refreshOrders();
}, 10000);
