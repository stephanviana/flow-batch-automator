import { api } from './management-api.js';
export { api };
import { element, productEditor } from './orders-editor.js';
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
const clearOrdersButton = document.querySelector('#clear-orders');
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
async function refresh() {
  const { orders } = await api('/manage/orders');
  savedOrders = orders;
  clearOrdersButton.disabled = !orders.some((order) => order.clearable);
  const list = document.querySelector('#orders');
  previewDisposers.splice(0).forEach((dispose) => dispose());
  list.replaceChildren();
  for (const order of orders)
    previewDisposers.push(renderOrder(list, order, api));
  if (!orders.length)
    element(list, 'p', 'Nenhum pedido salvo. O próximo pedido começa em #1.');
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
clearOrdersButton.addEventListener('click', () => {
  void action(async () => {
    const ids = savedOrders
      .filter((order) => order.clearable)
      .map((order) => order.id);
    if (!ids.length) return;
    clearOrdersButton.disabled = true;
    try {
      const result = await api('/manage/orders/clear', { ids });
      await refresh();
      document.querySelector('#clear-orders-feedback').textContent =
        `${result.cleared} pedido(s) removido(s) da lista. Próximo pedido: #${result.nextNumber}.`;
    } finally {
      clearOrdersButton.disabled = !savedOrders.some(
        (order) => order.clearable,
      );
    }
  });
});
refreshOrders();
