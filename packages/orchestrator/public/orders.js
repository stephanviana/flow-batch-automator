import { api } from './management-api.js';
export { api };
import { element, productEditor } from './orders-editor.js';
import { renderOrder } from './orders-cards.js';
import { icon } from './ui-icons.js';
for (const node of document.querySelectorAll('[data-icon]'))
  icon(node, node.dataset.icon);
const status = document.querySelector('#status'),
  form = document.querySelector('#order-form');
const products = [],
  container = document.querySelector('#products');
const previewDisposers = [];
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
  const { orders } = await api('/manage/orders'),
    list = document.querySelector('#orders');
  previewDisposers.splice(0).forEach((dispose) => dispose());
  list.replaceChildren();
  for (const order of orders) {
    previewDisposers.push(
      renderOrder(list, order, {
        api,
        report,
        action,
        refresh,
        onCancel() {
          status.textContent = `Pedido ${order.number} cancelado.`;
        },
      }),
    );
  }
  const first = orders[0];
  document.querySelector('#chat-instruction').textContent =
    `No chat: “Prepare o pedido ${first?.number ?? 1}”.`;
  if (!orders.length) element(list, 'p', 'Nenhum pedido salvo.');
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
