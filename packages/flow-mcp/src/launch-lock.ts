import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { FlowBrowserError } from './contracts.js';

export async function withLaunchLock(
  home: string,
  operation: () => Promise<void>,
): Promise<void> {
  const path = join(home, 'launch.lock');
  const lock = await open(path, 'wx', 0o600).catch(() => {
    throw new FlowBrowserError(
      'launch_locked',
      'Outra abertura do Chrome está em andamento, ou uma abertura anterior foi interrompida. Confira o processo antes de remover launch.lock.',
    );
  });
  try {
    await operation();
  } finally {
    await lock.close();
    await unlink(path);
  }
}
