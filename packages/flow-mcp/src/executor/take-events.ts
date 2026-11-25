import type { QueueCheckpoint, QueueProgress } from '@flow-batch/protocol';

export type Emit = (event: QueueCheckpoint | QueueProgress) => void;
export type Checkpoint = QueueCheckpoint extends infer T
  ? T extends QueueCheckpoint
    ? Omit<T, 'type' | 'taskId' | 'attemptId'>
    : never
  : never;
