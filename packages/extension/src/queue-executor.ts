import { runFlowTake, FlowRunError } from './flow-run.js';
import type {
  QueueExecute,
  QueueProgress,
  QueueCheckpoint,
  SimulationExecute,
} from '@flow-batch/protocol';

interface ActiveAttempt {
  taskId: string;
  attemptId: string;
  timers: ReturnType<typeof setTimeout>[];
  epoch: number;
  submitted: boolean;
  started: boolean;
  controller: AbortController;
}
export class QueueExecutor {
  private active: ActiveAttempt | undefined;
  private epoch = 0;

  run(command: QueueExecute, socket: WebSocket): void {
    if (this.active?.attemptId === command.attemptId) return;
    if (this.active) {
      socket.send(
        JSON.stringify({
          type: 'queue-progress',
          taskId: command.taskId,
          attemptId: command.attemptId,
          state: 'failed',
          error: {
            code: 'executor_busy',
            message: 'Another task is active',
            retryable: true,
            notSubmitted: true,
          },
        }),
      );
      return;
    }
    const active: ActiveAttempt = {
      taskId: command.taskId,
      attemptId: command.attemptId,
      timers: [],
      epoch: this.epoch,
      submitted: false,
      started: false,
      controller: new AbortController(),
    };
    this.active = active;
    void this.prepare(command, socket, active).catch((error: unknown) => {
      const safe =
        command.type === 'flow-execute'
          ? !active.started ||
            (error instanceof FlowRunError && error.notSubmitted)
          : !active.submitted;
      this.emit(socket, active, {
        type: 'queue-progress',
        taskId: command.taskId,
        attemptId: command.attemptId,
        state:
          command.type === 'flow-execute' && !safe ? 'uncertain' : 'failed',
        error: {
          code:
            error instanceof FlowRunError
              ? error.code
              : active.submitted
                ? 'executor_failed'
                : 'receipt_persistence_failed',
          message:
            error instanceof FlowRunError
              ? error.message
              : command.type === 'flow-execute'
                ? 'Não foi possível confirmar o resultado. Revise o projeto antes de gerar novamente.'
                : active.submitted
                  ? 'Simulated executor failed after submission'
                  : 'Could not persist the execution receipt',
          retryable: safe && command.type !== 'flow-execute',
          notSubmitted: safe,
        },
      });
      if (this.active === active) this.active = undefined;
    });
  }

  stop(): void {
    this.epoch++;
    this.active?.controller.abort();
    for (const timer of this.active?.timers ?? []) clearTimeout(timer);
    this.active = undefined;
  }

  private async prepare(
    command: QueueExecute,
    socket: WebSocket,
    active: ActiveAttempt,
  ): Promise<void> {
    const stored = await chrome.storage.local.get('queueReceipts');
    const receipts = Array.isArray(stored.queueReceipts)
      ? stored.queueReceipts.filter(
          (entry: unknown): entry is string => typeof entry === 'string',
        )
      : [];
    if (receipts.includes(command.attemptId)) {
      socket.close(4001, 'Duplicate execution receipt; review required');
      return;
    }
    await chrome.storage.local.set({
      queueReceipts: [...receipts, command.attemptId].slice(-100),
    });
    if (active.epoch !== this.epoch || this.active !== active) return;
    if (command.type === 'flow-execute') {
      active.started = true;
      await runFlowTake(command, active.controller.signal, (event) => {
        if (event.type === 'queue-progress' && event.state === 'submitted')
          active.submitted = true;
        this.emit(socket, active, event);
      });
      if (this.active === active) this.active = undefined;
      return;
    }
    const scenario = command.simulation.scenario;
    const transient =
      scenario === 'transient_before_submit' &&
      command.attemptNumber <= command.simulation.failAttempts;
    if (transient || scenario === 'permanent_before_submit') {
      this.emit(socket, active, {
        type: 'queue-progress',
        taskId: command.taskId,
        attemptId: command.attemptId,
        state: 'failed',
        error: {
          code: transient ? 'simulated_transient' : 'simulated_permanent',
          message: 'Simulated failure before submission',
          retryable: transient,
          notSubmitted: true,
        },
      });
      this.active = undefined;
      return;
    }
    this.schedule(command, socket, active);
  }

  private schedule(
    command: SimulationExecute,
    socket: WebSocket,
    active: ActiveAttempt,
  ): void {
    active.submitted = true;
    const generationId = `sim-${command.attemptId}`;
    const base = {
      type: 'queue-progress' as const,
      taskId: command.taskId,
      attemptId: command.attemptId,
    };
    this.emit(socket, active, { ...base, state: 'submitted', generationId });
    if (command.simulation.scenario === 'stall_after_submit') return;
    const stages = ['generating', 'download_pending', 'completed'] as const;
    stages.forEach((state, index) => {
      const timer = setTimeout(
        () => {
          if (this.active !== active) return;
          if (command.simulation.scenario === 'failure_after_submit') {
            this.emit(socket, active, {
              ...base,
              state: 'failed',
              error: {
                code: 'simulated_generation_failed',
                message: 'Simulated generation failed after submission',
                retryable: false,
                notSubmitted: false,
              },
            });
            for (const pending of active.timers) clearTimeout(pending);
            this.active = undefined;
            return;
          }
          this.emit(
            socket,
            active,
            state === 'completed'
              ? {
                  ...base,
                  state,
                  generationId,
                  result: {
                    simulated: true,
                    outputFile: null,
                    description:
                      'Simulation completed; no media generated or downloaded',
                  },
                }
              : { ...base, state, generationId },
          );
          if (state === 'completed') this.active = undefined;
        },
        Math.ceil((command.simulation.durationMs * (index + 1)) / 3),
      );
      active.timers.push(timer);
    });
  }

  private emit(
    socket: WebSocket,
    active: ActiveAttempt,
    message: QueueProgress | QueueCheckpoint,
  ): void {
    if (
      active.epoch === this.epoch &&
      this.active === active &&
      socket.readyState === WebSocket.OPEN
    )
      socket.send(JSON.stringify(message));
  }
}
