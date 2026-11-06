import type { TaskSummary } from '@flow-batch/protocol';

type VisibleTask = Pick<TaskSummary, 'id' | 'state' | 'revision'>;
export type ClearedTasks = Map<string, number>;

export function isFinishedTask(task: VisibleTask): boolean {
  return task.state === 'completed';
}

export function isClearedTask(
  task: VisibleTask,
  cleared: ClearedTasks,
): boolean {
  const revision = cleared.get(task.id);
  return (
    isFinishedTask(task) && revision !== undefined && task.revision <= revision
  );
}

export function clearFinishedTasks(
  tasks: readonly VisibleTask[],
  cleared: ClearedTasks,
): ClearedTasks {
  const next = new Map(cleared);
  for (const task of tasks)
    if (isFinishedTask(task))
      next.set(task.id, Math.max(next.get(task.id) ?? 0, task.revision));
  return next;
}
