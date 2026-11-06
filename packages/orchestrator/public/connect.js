import { api as management } from './management-api.js';
import { icon } from './ui-icons.js';

const status = document.querySelector('#status');
const indicator = document.querySelector('#connection-state');
const panel = document.querySelector('.connection-panel');
const requested = new URL(location.href).searchParams.get('request');
let busy = false;
let snapshot = '';
let loadFailed = false;
for (const node of document.querySelectorAll('[data-icon]'))
  icon(node, node.dataset.icon);

function text(parent, tag, content = '', className = '') {
  const element = document.createElement(tag);
  element.textContent = content;
  if (className) element.className = className;
  parent.append(element);
  return element;
}
function button(parent, label, action, className = '') {
  const element = text(parent, 'button', label, className);
  element.type = 'button';
  element.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    element.disabled = true;
    panel.setAttribute('aria-busy', 'true');
    try {
      await action();
      await refresh();
      status.className = '';
      status.textContent = 'Alteração confirmada.';
    } catch (error) {
      status.className = 'error';
      status.textContent = error.message;
    } finally {
      element.disabled = false;
      busy = false;
      panel.setAttribute('aria-busy', 'false');
    }
  });
  return element;
}
function rowIcon(parent, name) {
  icon(text(parent, 'span', '', 'row-icon'), name);
}
function emptyState(parent, title, description) {
  const row = text(parent, 'div', '', 'connection-row empty-state');
  rowIcon(row, 'link');
  const content = text(row, 'div', '', 'row-content');
  text(content, 'h3', title);
  text(content, 'p', description);
}
function identity(parent, extensionId, key, open) {
  const line = text(parent, 'div', '', 'identity-line');
  text(line, 'span', 'Identificador da extensão');
  const details = text(line, 'details', '', 'client-identity');
  details.dataset.identityKey = key;
  details.open = open.has(key);
  const summary = text(details, 'summary', 'Ver ID');
  summary.append(icon(summary, 'chevron'));
  text(details, 'code', extensionId);
}
function pendingRequest(parent, request, open) {
  const article = text(parent, 'article', '', 'connection-row pairing-request');
  article.dataset.requestId = request.id;
  rowIcon(article, 'link');
  const content = text(article, 'div', '', 'row-content');
  text(content, 'h3', 'Solicitação da extensão');
  text(content, 'p', request.code, 'code');
  identity(content, request.extensionId, request.id, open);
  const expiry = text(
    content,
    'p',
    `Expira às ${new Date(request.expiresAt).toLocaleTimeString()}`,
    'request-expiry',
  );
  expiry.title = 'Compare este código com o exibido no painel da extensão.';
  const actions = text(content, 'div', '', 'request-actions');
  button(actions, 'Confirmar conexão', () =>
    management(`/manage/requests/${request.id}`, { approve: true }),
  );
  button(
    actions,
    'Cancelar',
    () => management(`/manage/requests/${request.id}`, { approve: false }),
    'secondary',
  );
}
function clientRow(parent, client, open) {
  const article = text(parent, 'article', '', 'connection-row client-card');
  article.dataset.clientId = client.id;
  rowIcon(article, 'puzzle');
  const content = text(article, 'div', '', 'row-content');
  text(content, 'h3', 'Extensão do Flow Batch');
  identity(content, client.extensionId, client.id, open);
  const state = text(
    article,
    'p',
    client.revokedAt
      ? 'Acesso revogado'
      : client.connected
        ? 'Conectada'
        : 'Autorizada · desconectada',
    'client-state',
  );
  state.dataset.state = client.revokedAt
    ? 'revoked'
    : client.connected
      ? 'connected'
      : 'offline';
  if (!client.revokedAt)
    icon(
      button(
        article,
        'Revogar acesso',
        () => management(`/manage/clients/${client.id}/revoke`, {}),
        'danger revoke-button',
      ),
      'link',
    );
}
function connectionState(clients) {
  const connected = clients.filter((client) => client.connected).length;
  indicator.dataset.state = connected
    ? 'connected'
    : clients.length
      ? 'offline'
      : 'idle';
  indicator.textContent =
    connected === 1
      ? 'Extensão conectada'
      : connected > 1
        ? `${connected} extensões conectadas`
        : clients.length
          ? 'Extensão desconectada'
          : 'Nenhuma extensão conectada';
}
function renderPending(requests, open) {
  const pending = document.querySelector('#pending');
  pending.replaceChildren();
  document.querySelector('#pending-count').textContent = String(
    requests.length,
  );
  for (const request of requests) pendingRequest(pending, request, open);
  if (!requests.length)
    emptyState(
      pending,
      'Nenhuma solicitação pendente',
      'Para conectar outra extensão, inicie a conexão pelo painel dela.',
    );
}
function renderClients(records, open) {
  const clients = document.querySelector('#clients');
  clients.replaceChildren();
  const authorized = records.filter((client) => !client.revokedAt);
  document.querySelector('#clients-count').textContent = String(
    authorized.length,
  );
  for (const client of authorized) clientRow(clients, client, open);
  if (!authorized.length)
    emptyState(
      clients,
      'Nenhuma conexão autorizada',
      'Confirme uma solicitação para autorizar o acesso da extensão.',
    );
  const revoked = document.querySelector('#revoked-clients');
  revoked.replaceChildren();
  const history = records.filter((client) => client.revokedAt);
  document.querySelector('#revoked-history').hidden = !history.length;
  document.querySelector('#revoked-count').textContent = String(history.length);
  for (const client of history) clientRow(revoked, client, open);
}
function render(data) {
  const open = new Set(
    [...document.querySelectorAll('.client-identity[open]')].map(
      (node) => node.dataset.identityKey,
    ),
  );
  renderPending(
    data.pending.filter((entry) => !requested || entry.id === requested),
    open,
  );
  renderClients(data.clients, open);
}
async function refresh() {
  const data = await management('/manage/status');
  connectionState(data.clients.filter((client) => !client.revokedAt));
  const current = JSON.stringify(data);
  if (current !== snapshot) {
    render(data);
    snapshot = current;
  }
  if (loadFailed) {
    status.textContent = '';
    loadFailed = false;
  }
  if (!busy) panel.setAttribute('aria-busy', 'false');
}
function reportLoadFailure(error) {
  loadFailed = true;
  indicator.dataset.state = 'error';
  indicator.textContent = 'Conexão indisponível';
  status.className = 'error';
  status.textContent = error.message;
  if (!busy) panel.setAttribute('aria-busy', 'false');
}
void refresh().catch(reportLoadFailure);
setInterval(() => {
  if (!document.hidden && !busy) void refresh().catch(reportLoadFailure);
}, 3000);
