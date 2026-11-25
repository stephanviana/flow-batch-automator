const bridge = globalThis.flowDesktop;
const summary = document.querySelector('#summary');
const feedback = document.querySelector('#feedback');
const profileSelect = document.querySelector('#profile-select');
const createForm = document.querySelector('#create-profile-form');
const newProfileInput = document.querySelector('#new-profile-name');
const toggleQueueButton = document.querySelector('#toggle-queue');
const startExecutorButton = document.querySelector('#start-executor');

let busy = false;
let currentSnapshot = null;

function setFeedback(text, tone = '') {
  feedback.textContent = text;
  feedback.className = tone;
}

function browserLabel(browser) {
  switch (browser.phase) {
    case 'manual-login':
      return 'Login manual aberto';
    case 'browser-closed':
      return 'Chrome desconectado';
    case 'no-flow-tab':
      return 'Chrome aberto sem aba do Flow';
    case 'login-required':
      return 'Login do Flow pendente';
    case 'project-required':
      return 'Flow aberto (sem projeto selecionado)';
    case 'not-ready':
      return 'Projeto carregando';
    case 'busy':
      return 'Flow ocupando geração';
    case 'ready':
      return 'Flow pronto';
    default:
      return browser.phase;
  }
}

function render(snapshot) {
  currentSnapshot = snapshot;
  profileSelect.replaceChildren();
  for (const profile of snapshot.profiles) {
    const option = document.createElement('option');
    option.value = profile.name;
    option.textContent = profile.initialized
      ? profile.name
      : `${profile.name} (novo)`;
    option.selected = profile.name === snapshot.activeProfile;
    profileSelect.append(option);
  }
  const parts = [
    `Perfil: ${snapshot.activeProfile}`,
    browserLabel(snapshot.browser),
    snapshot.workerRunning
      ? 'Executor conectado'
      : snapshot.executor.authorized
        ? 'Executor parado'
        : 'Executor não pareado',
    snapshot.blockedByReview
      ? 'Fila bloqueada (item incerto)'
      : snapshot.queueRunning
        ? 'Fila ativa'
        : 'Fila pausada',
  ];
  if (!snapshot.chromeExecutable) parts.push('Chrome não encontrado');
  summary.textContent = parts.join(' · ');

  startExecutorButton.textContent = snapshot.executor.needsPairing
    ? 'Parear executor'
    : snapshot.workerRunning
      ? 'Executor ativo'
      : 'Iniciar executor';
  startExecutorButton.disabled =
    busy || (snapshot.executor.authorized && snapshot.workerRunning);

  toggleQueueButton.textContent = snapshot.queueRunning
    ? 'Pausar fila'
    : 'Retomar fila';
  toggleQueueButton.disabled =
    busy || !snapshot.executor.authorized || snapshot.blockedByReview;
}

async function runAction(operation) {
  if (busy) return;
  busy = true;
  document
    .querySelectorAll('.desktop-bar button, .desktop-bar select')
    .forEach((control) => {
      control.disabled = true;
    });
  try {
    const outcome = await operation();
    if (outcome?.snapshot) render(outcome.snapshot);
    if (outcome?.message) setFeedback(outcome.message, 'success');
  } catch (error) {
    setFeedback(
      error instanceof Error ? error.message : 'Falha na operação desktop.',
      'error',
    );
  } finally {
    busy = false;
    document
      .querySelectorAll('.desktop-bar button, .desktop-bar select')
      .forEach((control) => {
        control.disabled = false;
      });
    if (currentSnapshot) render(currentSnapshot);
  }
}

document
  .querySelector('#nav-orders')
  .addEventListener('click', () => void bridge.navigate('/orders'));
document
  .querySelector('#nav-connect')
  .addEventListener('click', () => void bridge.navigate('/connect'));
document
  .querySelector('#open-login')
  .addEventListener('click', () => void runAction(() => bridge.openLogin()));
document
  .querySelector('#connect-browser')
  .addEventListener(
    'click',
    () => void runAction(() => bridge.connectBrowser()),
  );
startExecutorButton.addEventListener(
  'click',
  () => void runAction(() => bridge.startOrPairExecutor()),
);
toggleQueueButton.addEventListener(
  'click',
  () => void runAction(() => bridge.toggleQueue()),
);
document
  .querySelector('#install-antigravity')
  .addEventListener(
    'click',
    () => void runAction(() => bridge.installMcp('antigravity')),
  );
document
  .querySelector('#install-codex')
  .addEventListener(
    'click',
    () => void runAction(() => bridge.installMcp('codex')),
  );
document
  .querySelector('#open-videos')
  .addEventListener('click', () => void bridge.openFolder('videos'));

profileSelect.addEventListener('change', () => {
  void runAction(() => bridge.selectProfile(profileSelect.value));
});

document.querySelector('#new-profile').addEventListener('click', () => {
  createForm.hidden = false;
  newProfileInput.value = '';
  newProfileInput.focus();
});
document.querySelector('#cancel-profile').addEventListener('click', () => {
  createForm.hidden = true;
});
createForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = newProfileInput.value.trim();
  createForm.hidden = true;
  if (name) void runAction(() => bridge.createProfile(name));
});

async function refresh() {
  if (busy) return;
  try {
    render(await bridge.getSnapshot());
  } catch (error) {
    setFeedback(
      error instanceof Error ? error.message : 'Erro ao consultar status.',
      'error',
    );
  }
}

void refresh();
setInterval(() => {
  void refresh();
}, 4000);
