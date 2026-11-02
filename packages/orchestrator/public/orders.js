import { element, productEditor, formats } from './orders-editor.js';
const status = document.querySelector('#status'),
  form = document.querySelector('#order-form');
const products = [],
  container = document.querySelector('#products');
let draftId = crypto.randomUUID(),
  busy = false;
export async function api(path, body, headers = {}) {
  const binary = body instanceof File;
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    redirect: 'error',
    headers: {
      'X-Flow-Management': '1',
      ...(body !== undefined && !binary
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...headers,
    },
    ...(body !== undefined
      ? { body: binary ? body : JSON.stringify(body) }
      : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error ?? 'Não foi possível confirmar a operação.');
  return result;
}
function addProduct() {
  const editor = productEditor(container);
  products.push(editor);
  editor.remove.addEventListener('click', () => {
    products.splice(products.indexOf(editor), 1);
    editor.container.remove();
  });
}
function report(error) {
  status.textContent = error.message;
  status.className = 'error';
}
async function action(operation) {
  if (busy) return;
  busy = true;
  const controls = [...form.querySelectorAll('button,input,select,textarea')];
  controls.forEach((control) => (control.disabled = true));
  status.className = '';
  try {
    await operation();
  } catch (error) {
    report(error);
  } finally {
    controls.forEach((control) => (control.disabled = false));
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
    container.replaceChildren();
    products.length = 0;
    form.reset();
    addProduct();
    await refresh();
  });
});
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
async function refresh() {
  const { orders } = await api('/manage/orders'),
    list = document.querySelector('#orders');
  list.replaceChildren();
  for (const order of orders) {
    const card = element(list, 'article');
    card.dataset.orderNumber = String(order.number);
    element(card, 'h3', `Pedido ${order.number} · ${order.name}`);
    element(card, 'span', states[order.state], 'badge');
    if (order.lease)
      element(
        card,
        'p',
        `Preparando: ${order.lease.worker} · reserva até ${new Date(order.lease.expiresAt).toLocaleTimeString()}`,
      );
    const table = element(card, 'ul');
    for (const product of order.products)
      element(
        table,
        'li',
        `${product.name}: ${product.groups.map((group) => `${group.count} × ${formats.find(([key]) => key === group.format)?.[1]}`).join('; ')}`,
      );
    for (const dispatch of order.dispatches)
      if (dispatch.message) element(card, 'p', dispatch.message);
    if (Object.keys(order.counts).length)
      element(
        card,
        'p',
        Object.entries(order.counts)
          .map(([key, count]) => `${count} ${key}`)
          .join(' · '),
      );
    if (order.preparationHash) {
      const count = order.generationCounts;
      element(
        card,
        'p',
        `Limite de geração: ${count.images} imagens e ${count.videos} vídeos.`,
      );
      const preview = element(card, 'button', 'Ver prévia', 'secondary');
      preview.addEventListener('click', async () => {
        preview.disabled = true;
        try {
          const { order: current } = await api(
            `/manage/orders/${order.number}`,
          );
          const area = element(card, 'div');
          for (const prepared of current.preparation.products) {
            const product = current.products.find(
              (product) => product.id === prepared.id,
            );
            for (const variation of prepared.variations) {
              details(
                area,
                `${product.name} · ${variation.name} · falas`,
                JSON.stringify(variation.copy, null, 2),
              );
              details(
                area,
                `${variation.name} · imagens`,
                JSON.stringify(
                  {
                    gancho: variation.hookImage,
                    vendedora: variation.presenterImage,
                  },
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
    if (order.materials.some((material) => !material.available))
      element(
        card,
        'p',
        'As cópias dos materiais deste pedido foram removidas. O histórico foi mantido.',
      );
    if (['awaiting-preparation', 'prepared'].includes(order.state)) {
      const cancel = element(card, 'button', 'Cancelar pedido', 'secondary');
      cancel.addEventListener(
        'click',
        () =>
          void action(async () => {
            await api(`/manage/orders/${order.id}/cancel`, {});
            status.textContent = `Pedido ${order.number} cancelado.`;
            await refresh();
          }),
      );
    }
  }
  if (!orders.length) element(list, 'p', 'Nenhum pedido salvo.');
}
document
  .querySelector('#refresh')
  .addEventListener('click', () => void refresh().catch(report));
document.querySelector('#preview-cleanup').addEventListener(
  'click',
  () =>
    void action(async () => {
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
void refresh().catch(report);
setInterval(() => {
  if (
    !document.hidden &&
    !busy &&
    !document.querySelector('#orders details[open]')
  )
    void refresh().catch(report);
}, 10000);
