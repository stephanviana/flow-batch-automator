import {
  popupRequestSchema,
  simulationSchema,
  type Simulation,
  queueSnapshotSchema,
  taskDetailSchema,
  type QueueSnapshot,
  type TaskDetail,
  type FlowInspection,
} from '@flow-batch/protocol';
import { z } from 'zod';
import { ExtensionConnection } from './connection.js';
import { preferences, readState, setState } from './state.js';
import { signedRequest } from './api.js';
import { ApiError } from './api.js';
import { queueCommand } from './queue-client.js';
import { inspectFlow, openFlow } from './flow.js';
import { FlowInputError } from './flow-errors.js';

const connection = new ExtensionConnection();
let pendingCommand: Promise<unknown> = Promise.resolve();
let inspectedTaskId: string | undefined;
let operationError: string | null = null;
let flow: FlowInspection | null = null;

async function snapshot(): Promise<{
  state: Awaited<ReturnType<typeof readState>>;
  simulations: Simulation[];
  queue: QueueSnapshot | null;
  inspection: TaskDetail | null;
  operationError: string | null;
  flow: FlowInspection | null;
}> {
  const state = await readState();
  const config = await preferences();
  let simulations: Simulation[] = [];
  let queue: QueueSnapshot | null = null;
  let inspection: TaskDetail | null = null;
  if (config.clientId && !config.revoked && state.phase === 'connected') {
    try {
      simulations = z
        .object({ simulations: z.array(simulationSchema) })
        .parse(
          await signedRequest(config.clientId, 'GET', '/api/simulations'),
        ).simulations;
    } catch {
      /* Socket recovery owns connectivity status; never retry a simulation. */
    }
    try {
      queue = queueSnapshotSchema.parse(
        await signedRequest(config.clientId, 'GET', '/api/queue'),
      );
    } catch {
      /* Keep the connection status independent from queue availability. */
    }
    if (inspectedTaskId) {
      try {
        inspection = taskDetailSchema.parse(
          await signedRequest(config.clientId, 'POST', '/api/queue/task', {
            taskId: inspectedTaskId,
          }),
        );
      } catch {
        /* A revoked or missing task is never displayed from cache. */
      }
    }
  }
  return {
    state,
    simulations,
    queue,
    inspection,
    operationError,
    flow,
  };
}

async function command(
  message: z.infer<typeof popupRequestSchema>,
): Promise<Awaited<ReturnType<typeof snapshot>>> {
  if (message.type === 'flow-open') await openFlow();
  else if (message.type === 'flow-inspect') flow = await inspectFlow();
  else if (message.type === 'connect') await connection.connect();
  else if (message.type === 'disconnect') await connection.disconnect();
  else if (message.type === 'reconnect') await connection.reconnect();
  else if (message.type === 'simulate') {
    const config = await preferences();
    if (
      !config.clientId ||
      config.revoked ||
      (await readState()).phase !== 'connected'
    )
      throw new Error('Connect first');
    await signedRequest(config.clientId, 'POST', '/api/simulations', {
      requestId: crypto.randomUUID(),
      durationMs: 5000,
    });
  } else if (message.type === 'queue-inspect') {
    inspectedTaskId = message.taskId;
  } else if (
    message.type.startsWith('queue-') ||
    message.type.startsWith('enqueue-')
  ) {
    const config = await preferences();
    if (!config.clientId || config.revoked) throw new Error('Connect first');
    await queueCommand(config.clientId, message);
  }
  return snapshot();
}

chrome.runtime.onMessage.addListener(
  (raw: unknown, sender, respond): boolean => {
    if (
      sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL('sidepanel.html')
    )
      return false;
    const parsed = popupRequestSchema.safeParse(raw);
    if (!parsed.success) return false;
    const operation =
      parsed.data.type === 'status'
        ? snapshot()
        : pendingCommand.then(() => {
            operationError = null;
            return command(parsed.data);
          });
    if (parsed.data.type !== 'status')
      pendingCommand = operation.catch(() => undefined);
    void operation
      .then(respond)
      .catch(async (error: unknown): Promise<void> => {
        if (
          parsed.data.type.startsWith('queue-') ||
          parsed.data.type.startsWith('enqueue-')
        ) {
          operationError =
            error instanceof FlowInputError
              ? error.message
              : error instanceof ApiError && error.status === 409
                ? 'O registro mudou ou a ação exige revisão. Confira o lote e o histórico antes de continuar.'
                : 'Não foi possível operar a fila. Verifique a conexão e tente novamente.';
        } else if (parsed.data.type.startsWith('flow-')) {
          flow = {
            phase: 'error',
            message: 'Não foi possível acessar o Flow. Confira a aba aberta.',
            projectId: null,
            checkedAt: Date.now(),
          };
        } else
          await setState({
            phase: 'error',
            message: 'Operação indisponível. Confira o servidor e a conexão.',
          });
        respond(await snapshot());
      });
    return true;
  },
);
chrome.alarms.onAlarm.addListener((alarm): void => {
  if (alarm.name === 'flow-recover') void connection.recover();
});
chrome.runtime.onStartup.addListener((): void => {
  void connection.recover();
});
chrome.runtime.onInstalled.addListener((): void => {
  void connection.recover();
});
void connection.recover();
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
