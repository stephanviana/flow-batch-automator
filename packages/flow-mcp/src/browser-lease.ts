import { mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { FlowBrowserError } from './contracts.js';

/** Shared by MCP inspection and the worker so neither can navigate mid-take. */
export async function reserveBrowser(
  home: string,
): Promise<() => Promise<void>> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const path = join(home, 'browser-operation.lock');
  const file = await open(path, 'wx', 0o600).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new FlowBrowserError(
      'browser_reserved',
      'O navegador está reservado por outra operação. Se houve interrupção, confira a fila e o processo antes de remover browser-operation.lock.',
    );
  });
  try {
    await file.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
  } catch (error) {
    await file.close();
    await unlink(path);
    throw error;
  }
  return async (): Promise<void> => {
    await file.close();
    await unlink(path);
  };
}
