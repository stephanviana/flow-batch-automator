import type { DispatchIssue, PopupRequest } from '@flow-batch/protocol';
let stamp = '';

export function renderDispatchIssues(
  issues: DispatchIssue[],
  send: (request: PopupRequest) => Promise<unknown>,
): void {
  const section = document.querySelector<HTMLElement>('#dispatch-issues');
  const list = document.querySelector('#dispatch-issues-list');
  if (!section || !list) return;
  section.hidden = issues.length === 0;
  const next = JSON.stringify(issues);
  if (stamp === next) return;
  stamp = next;
  list.replaceChildren();
  for (const issue of issues) {
    const row = document.createElement('li');
    const title = document.createElement('h3');
    title.textContent = issue.name;
    const reason = document.createElement('p');
    reason.textContent =
      issue.message ||
      'O envio deste pedido foi bloqueado. Consulte o diagnóstico.';
    const review = document.createElement('button');
    review.type = 'button';
    review.className = 'secondary';
    review.textContent = 'Revisar pedido';
    review.addEventListener('click', async (): Promise<void> => {
      review.disabled = true;
      try {
        await send({ type: 'orders-open', dispatchId: issue.id });
      } catch {
        reason.textContent =
          'Não foi possível abrir a revisão. Abra o painel de pedidos e use Revisar pedido.';
      } finally {
        review.disabled = false;
      }
    });
    row.append(title, reason, review);
    list.append(row);
  }
}
