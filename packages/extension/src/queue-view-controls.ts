import type { QueueSnapshot, TaskSummary } from '@flow-batch/protocol';
import {
  clearFinishedTasks,
  isClearedTask,
  isFinishedTask,
  type ClearedTasks,
} from './queue-visibility.js';

export class QueueViewControls {
  private cleared: ClearedTasks = new Map();
  private queue: QueueSnapshot | null = null;

  constructor(private readonly render: () => void) {}

  initialize(): void {
    document.querySelector('#queue-clear')?.addEventListener('click', () => {
      if (!this.queue) return;
      this.cleared = clearFinishedTasks(this.queue.tasks, this.cleared);
      this.render();
      const feedback = document.querySelector('#queue-view-feedback');
      if (feedback)
        feedback.textContent =
          'Concluídos removidos da lista. Histórico e arquivos preservados.';
    });
  }

  visible(task: TaskSummary): boolean {
    return !isClearedTask(task, this.cleared);
  }

  update(queue: QueueSnapshot | null): void {
    this.queue = queue;
    const clear = document.querySelector<HTMLButtonElement>('#queue-clear');
    if (clear)
      clear.disabled = !queue?.tasks.some(
        (task) => isFinishedTask(task) && this.visible(task),
      );
  }
}
