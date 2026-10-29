import { popupReplySchema } from '@flow-batch/protocol';

const status = document.querySelector<HTMLParagraphElement>('#status');
const code = document.querySelector<HTMLParagraphElement>('#code');
const history = document.querySelector<HTMLUListElement>('#history');
const simulate = document.querySelector<HTMLButtonElement>(
  '[data-action="simulate"]',
);
if (!status || !code || !history || !simulate)
  throw new Error('Popup elements missing');
const labels = {
  sent: 'Enviada',
  running: 'Em execução',
  completed: 'Concluída',
  interrupted: 'Interrompida · sem reenvio',
};

async function refresh(type = 'status'): Promise<void> {
  const response: unknown = await chrome.runtime.sendMessage({ type });
  const data = popupReplySchema.parse(response);
  status!.textContent = data.state.message;
  code!.textContent = data.state.code ? `Código: ${data.state.code}` : '';
  simulate!.disabled = data.state.phase !== 'connected';
  history!.replaceChildren();
  for (const task of data.simulations) {
    const entry = document.createElement('li');
    entry.textContent = `${task.id.slice(0, 8)} · ${labels[task.state]}`;
    history!.append(entry);
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-action]',
)) {
  button.addEventListener('click', async (): Promise<void> => {
    button.disabled = true;
    try {
      await refresh(button.dataset.action);
    } catch {
      status.textContent = 'Recarregue a extensão e tente novamente.';
    } finally {
      button.disabled = button === simulate ? simulate.disabled : false;
    }
  });
}
void refresh().catch((): void => {
  status.textContent = 'Não foi possível consultar a extensão.';
});
setInterval((): void => {
  void refresh().catch((): void => {
    status.textContent = 'Aguardando resposta do worker…';
  });
}, 2000);
