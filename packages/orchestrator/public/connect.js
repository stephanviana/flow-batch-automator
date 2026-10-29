const status = document.querySelector('#status');
const requested = new URL(location.href).searchParams.get('request');
async function management(path, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'X-Flow-Management': '1',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    credentials: 'same-origin',
    redirect: 'error',
  });
  if (!response.ok)
    throw new Error(
      'Operação recusada. Recarregue a página se a sessão expirou.',
    );
  return response.json();
}
function text(parent, tag, content, className) {
  const element = document.createElement(tag);
  element.textContent = content;
  if (className) element.className = className;
  parent.append(element);
  return element;
}
function button(parent, label, action) {
  const element = text(parent, 'button', label);
  element.addEventListener('click', async () => {
    element.disabled = true;
    try {
      await action();
      await refresh();
      status.textContent = 'Alteração confirmada.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      element.disabled = false;
    }
  });
}
async function refresh() {
  const data = await management('/manage/status');
  const pending = document.querySelector('#pending');
  pending.replaceChildren();
  for (const request of data.pending.filter(
    (entry) => !requested || entry.id === requested,
  )) {
    const article = text(pending, 'article', '');
    text(article, 'p', request.code, 'code');
    text(article, 'p', `Extensão: ${request.extensionId}`);
    text(
      article,
      'p',
      `Expira às ${new Date(request.expiresAt).toLocaleTimeString()}`,
    );
    button(article, 'Confirmar conexão', () =>
      management(`/manage/requests/${request.id}`, { approve: true }),
    );
    button(article, 'Cancelar', () =>
      management(`/manage/requests/${request.id}`, { approve: false }),
    );
  }
  if (!pending.childElementCount)
    text(
      pending,
      'p',
      'Nenhuma solicitação pendente. Inicie pelo popup da extensão.',
    );
  const clients = document.querySelector('#clients');
  clients.replaceChildren();
  for (const client of data.clients) {
    const article = text(clients, 'article', '');
    text(article, 'p', `Extensão: ${client.extensionId}`);
    text(
      article,
      'p',
      client.revokedAt
        ? 'Acesso revogado'
        : client.connected
          ? 'Conectada'
          : 'Autorizada · desconectada',
    );
    if (!client.revokedAt)
      button(article, 'Revogar acesso', () =>
        management(`/manage/clients/${client.id}/revoke`, {}),
      );
  }
  if (!clients.childElementCount)
    text(clients, 'p', 'Nenhuma conexão autorizada.');
}
void refresh().catch((error) => {
  status.textContent = error.message;
});
setInterval(() => {
  if (!document.hidden)
    void refresh().catch((error) => {
      status.textContent = error.message;
    });
}, 3000);
