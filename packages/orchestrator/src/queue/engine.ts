import type { QueueProgress, QueueExecute } from '@flow-batch/protocol';
import type { QueueTransport, QueueEvents } from './ports.js';
import type { QueueRepository } from './repository.js';
import type { QueueMutations } from './mutations.js';

export class QueueEngine implements QueueEvents {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  constructor(
    private readonly repository: QueueRepository,
    private readonly mutations: QueueMutations,
    private readonly transport: QueueTransport,
  ) {}

  connected(): void {
    this.wake();
  }
  disconnected(connectionId: string, reason = 'connection-lost'): void {
    this.mutations.interrupt(connectionId, reason);
    this.wake();
  }
  progress(
    clientId: string,
    connectionId: string,
    message: QueueProgress,
  ): void {
    this.mutations.progress(clientId, connectionId, message);
    this.wake();
  }
  wake(delay = 0): void {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.tick();
      },
      Math.max(0, delay),
    ).unref();
  }
  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private tick(): void {
    if (this.stopped) return;
    const now = Date.now();
    const active = this.repository.active();
    if (active) {
      const remaining = (active.deadlineAt ?? now) - now;
      if (remaining > 0) {
        this.wake(remaining);
        return;
      }
      this.disconnected(active.connectionId ?? '', 'attempt-timeout');
      if (active.connectionId) this.transport.closeQueue(active.connectionId);
      return;
    }
    const connections = this.transport.queueConnections();
    const candidate = this.repository.candidate(
      connections.map((connection) => connection.clientId),
      connections
        .filter((connection) => connection.flowCapable)
        .map((connection) => connection.clientId),
    );
    if (!candidate) return;
    if (candidate.summary.nextAttemptAt > now) {
      this.wake(candidate.summary.nextAttemptAt - now);
      return;
    }
    const session = connections.find(
      (connection) => connection.clientId === candidate.clientId,
    );
    if (!session) return;
    const task = this.repository.claim(
      candidate.summary.id,
      session.connectionId,
      now,
    );
    if (!task?.activeAttemptId) return;
    try {
      const message: QueueExecute = {
        type: 'queue-execute',
        taskId: task.summary.id,
        attemptId: task.activeAttemptId,
        attemptNumber: task.summary.attemptCount,
        simulation: task.input.simulation,
      };
      const sent = this.transport.sendQueue(session.connectionId, message);
      if (!sent)
        this.disconnected(session.connectionId, 'dispatch-outcome-unknown');
    } catch {
      this.disconnected(session.connectionId, 'dispatch-outcome-unknown');
      this.transport.closeQueue(session.connectionId);
    }
    this.wake(5000);
  }
}
