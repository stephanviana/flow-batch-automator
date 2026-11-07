import {
  preparationFormatLabels,
  preparationFormatSchema,
  type TaskSummary,
} from '@flow-batch/protocol';
import { activitySteps, type Activity } from './queue-activity-state.js';

type Icon = 'check' | 'download' | 'waiting' | 'warning' | 'error' | 'working';
const iconPaths: Record<Icon, string> = {
  check: 'M4 12l5 5L20 6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4',
  waiting: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  warning: 'M12 8v5m0 3v1M12 3 2 21h20L12 3',
  error: 'm7 7 10 10M17 7 7 17',
  working: '',
};
function icon(container: Element, name: Icon): void {
  if (container.getAttribute('data-icon') === name) return;
  container.setAttribute('data-icon', name);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', iconPaths[name]);
  svg.append(path);
  container.replaceChildren(svg);
}
function text(element: Element | null, value: string): void {
  if (element && element.textContent !== value) element.textContent = value;
}
function taskMeta(task: TaskSummary): string {
  const [formatKey, ...variation] = task.video.split(' · ');
  const format = preparationFormatSchema.safeParse(formatKey);
  const names = variation.map((name) =>
    format.success && name.startsWith(`${format.data} `)
      ? `Variação ${name.slice(format.data.length + 1)}`
      : name,
  );
  const video = format.success
    ? [preparationFormatLabels[format.data], ...names].join(' · ')
    : task.video;
  const take = task.take.replace(/^(\d+)[-\s]+(.+)$/, 'Take $1 — $2');
  return `${video} · ${take}`;
}
function stepRow(label: string): HTMLLIElement {
  const row = document.createElement('li');
  const marker = document.createElement('span');
  marker.className = 'step-marker';
  marker.setAttribute('aria-hidden', 'true');
  const content = document.createElement('div');
  content.className = 'step-content';
  const caption = document.createElement('span');
  caption.className = 'step-label';
  caption.textContent = label;
  const time = document.createElement('span');
  time.className = 'step-time';
  const status = document.createElement('span');
  status.className = 'step-status';
  content.append(caption, time);
  row.append(marker, content, status);
  return row;
}
function elapsed(task: TaskSummary): string {
  const seconds = Math.max(0, Math.floor((Date.now() - task.updatedAt) / 1000));
  return seconds < 60
    ? `${seconds} s`
    : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
function currentLabel(activity: Activity): string {
  if (activity.tone === 'warning') return 'Revisão necessária';
  if (activity.tone === 'error') return 'Interrompida';
  return activity.busy ? 'Em andamento' : 'Aguardando';
}
function toneIcon(activity: Activity): Icon {
  if (activity.busy) return 'working';
  const icons: Record<Activity['tone'], Icon> = {
    idle: 'waiting',
    working: 'waiting',
    success: 'check',
    warning: 'warning',
    error: 'error',
  };
  return icons[activity.tone];
}
function renderStep(
  row: Element,
  activity: Activity,
  index: number,
  total: number,
): void {
  const done = index < activity.step;
  const current = index === activity.step;
  row.setAttribute(
    'data-status',
    done ? 'done' : current ? 'current' : 'waiting',
  );
  if (current) row.setAttribute('aria-current', 'step');
  else row.removeAttribute('aria-current');
  const marker = done
    ? 'check'
    : current
      ? toneIcon(activity)
      : index === total - 1
        ? 'download'
        : 'waiting';
  icon(row.querySelector('.step-marker')!, marker);
  const completed =
    activity.task?.step === 'image_reused' && index === 1
      ? 'Reutilizada'
      : 'Concluída';
  text(
    row.querySelector('.step-status'),
    done ? completed : current ? currentLabel(activity) : 'Aguardando',
  );
  const time = row.querySelector<HTMLElement>('.step-time')!;
  time.hidden = !current || !activity.busy;
  text(
    time,
    current && activity.busy && activity.task
      ? `Há ${elapsed(activity.task)} nesta etapa`
      : '',
  );
}
function renderSteps(activity: Activity): void {
  const list = document.querySelector<HTMLOListElement>('#queue-steps');
  if (!list) return;
  list.hidden = !activity.task;
  if (!activity.task) return;
  const labels = activitySteps[activity.task.executor];
  if (list.dataset.kind !== activity.task.executor) {
    list.replaceChildren(...labels.map(stepRow));
    list.dataset.kind = activity.task.executor;
  }
  Array.from(list.children).forEach((row, index) =>
    renderStep(row, activity, index, labels.length),
  );
}
function renderTaskHeader(task: TaskSummary | null): void {
  const header = document.querySelector<HTMLElement>('#queue-activity-task')!;
  header.hidden = !task;
  text(document.querySelector('#queue-activity-product'), task?.product ?? '');
  text(
    document.querySelector('#queue-activity-meta'),
    task ? taskMeta(task) : '',
  );
}
export function renderActivityCard(activity: Activity, paused: boolean): void {
  const root = document.querySelector<HTMLElement>('#queue-activity');
  if (!root) return;
  root.dataset.tone = activity.tone;
  root.dataset.busy = String(activity.busy);
  renderTaskHeader(activity.task);
  text(document.querySelector('#queue-activity-title'), activity.title);
  const detail =
    activity.task && activity.busy && activity.tone === 'working'
      ? `Etapa ${activity.step + 1} de ${activitySteps[activity.task.executor].length}`
      : activity.detail;
  text(document.querySelector('#queue-activity-detail'), detail);
  const indicator = root.querySelector('.activity-indicator')!;
  icon(indicator, toneIcon(activity));
  const note = document.querySelector<HTMLElement>('#queue-activity-note')!;
  note.hidden = !paused || !activity.busy || !activity.task;
  text(note, 'O take atual continua. Os próximos takes estão pausados.');
  renderSteps(activity);
}
