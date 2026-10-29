import {
  popupRequestSchema,
  simulationSchema,
  type Simulation,
} from '@flow-batch/protocol';
import { z } from 'zod';
import { ExtensionConnection } from './connection.js';
import { preferences, readState, setState } from './state.js';
import { signedRequest } from './api.js';

const connection = new ExtensionConnection();
let pendingCommand: Promise<unknown> = Promise.resolve();

async function snapshot(): Promise<{
  state: Awaited<ReturnType<typeof readState>>;
  simulations: Simulation[];
}> {
  const state = await readState();
  const config = await preferences();
  let simulations: Simulation[] = [];
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
  }
  return { state, simulations };
}

async function command(
  message: z.infer<typeof popupRequestSchema>,
): Promise<Awaited<ReturnType<typeof snapshot>>> {
  if (message.type === 'connect') await connection.connect();
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
  }
  return snapshot();
}

chrome.runtime.onMessage.addListener(
  (raw: unknown, sender, respond): boolean => {
    if (
      sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL('popup.html')
    )
      return false;
    const parsed = popupRequestSchema.safeParse(raw);
    if (!parsed.success) return false;
    const operation =
      parsed.data.type === 'status'
        ? snapshot()
        : pendingCommand.then(() => command(parsed.data));
    if (parsed.data.type !== 'status')
      pendingCommand = operation.catch(() => undefined);
    void operation.then(respond).catch(async (): Promise<void> => {
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
