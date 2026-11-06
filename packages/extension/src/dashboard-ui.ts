import type { QueueSnapshot } from '@flow-batch/protocol';
import { queueActivity } from './queue-activity.js';

function text(selector: string, value: string): void {
  const element = document.querySelector(selector);
  if (element && element.textContent !== value) element.textContent = value;
}

export function renderConnectionBadge(connected: boolean): void {
  const badge = document.querySelector<HTMLElement>('#connection-badge');
  if (!badge) return;
  badge.dataset.connected = String(connected);
  badge.textContent = connected ? 'Conectada' : 'Offline';
}

export function renderDashboard(
  queue: QueueSnapshot | null,
  error: string | null,
): void {
  const counts = queue?.counts;
  text('#count-pending', counts ? String(counts.queued) : '—');
  text(
    '#count-active',
    counts
      ? String(
          counts.dispatching +
            counts.submitted +
            counts.generating +
            counts.download_pending,
        )
      : '—',
  );
  text('#count-completed', counts ? String(counts.completed) : '—');
  const activity = queueActivity(queue);
  text(
    '#overview-title',
    !queue && error ? 'Fila indisponível' : activity.title,
  );
  text('#overview-detail', !queue && error ? error : activity.detail);
  const card = document.querySelector<HTMLElement>('.overview-card');
  if (card) card.dataset.tone = !queue && error ? 'warning' : activity.tone;
}
