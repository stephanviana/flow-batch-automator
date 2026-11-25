import { open, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ProfileBrowser } from '../browser.js';
import type { BrowserConfig } from '../config.js';
import { FlowBrowserError } from '../contracts.js';
import { ExecutorApi } from './api.js';
import { BrowserTakeExecutor } from './take.js';
import { processBrowserDispatch } from './dispatch.js';
import { WorkerChannel } from './worker-channel.js';

async function stopRequested(home: string): Promise<boolean> {
  try {
    const raw = await readFile(join(home, 'worker-stop.json'), 'utf8');
    const parsed = JSON.parse(raw) as { pid?: unknown };
    return parsed.pid === process.pid;
  } catch {
    return false;
  }
}

export async function runBrowserWorker(
  config: BrowserConfig,
  base?: string,
): Promise<void> {
  const api = await ExecutorApi.open(config.home, base);
  await api.call('GET', '/api/identity');
  const lockPath = join(config.home, 'worker.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => {
    throw new FlowBrowserError(
      'worker_locked',
      'Já existe um executor local, ou sua execução anterior foi interrompida. Confira o processo e a fila antes de remover worker.lock.',
    );
  });
  await lock.writeFile(
    JSON.stringify({ pid: process.pid, clientId: api.clientId }),
  );
  const browser = new ProfileBrowser(config);
  const controller = new AbortController();
  const executor = new BrowserTakeExecutor(browser, config.home);
  const stop = (): void => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const stopWatcher = setInterval(() => {
    void stopRequested(config.home).then((requested) => {
      if (requested) stop();
    });
  }, 400);
  stopWatcher.unref();
  let channel: WorkerChannel | undefined;
  try {
    if (!(await browser.connect()))
      throw new FlowBrowserError(
        'browser_closed',
        'Use pnpm flow:connect antes de iniciar o executor.',
      );
    channel = await WorkerChannel.open(api, executor, controller);
    await writeFile(
      join(config.home, 'worker-status.json'),
      JSON.stringify({
        pid: process.pid,
        clientId: api.clientId,
        state: 'connected',
        at: Date.now(),
      }),
      { mode: 0o600 },
    );
    while (!controller.signal.aborted) {
      if (await stopRequested(config.home)) {
        stop();
        break;
      }
      if (!channel.busy) {
        try {
          await processBrowserDispatch(
            api,
            browser,
            config.home,
            controller.signal,
          );
        } catch {
          stop();
        }
      }
      await delay(2000, undefined, { signal: controller.signal }).catch(
        () => {},
      );
    }
  } finally {
    clearInterval(stopWatcher);
    controller.abort();
    await unlink(join(config.home, 'worker-stop.json')).catch(() => {});
    await channel?.close();
    await browser.disconnect();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await lock.close();
    await unlink(lockPath);
  }
}
