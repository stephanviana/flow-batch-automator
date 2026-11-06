import { spawn } from 'node:child_process';
import { lstat, open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ensureDirectory } from '../mcp/install-files.js';
import type { Installation } from './config.js';
import {
  nativeAddress,
  nativeDataDirectory,
  readNativeRecord,
  type NativeStatus,
} from './native-state.js';
import { requestNativeControl } from './native-control.js';

export async function nativeStatus(
  root: string,
  config: Installation,
): Promise<
  NativeStatus | { runtime: 'native'; state: 'stopped' | 'unreachable' }
> {
  const record = await readNativeRecord(root);
  if (!record) return { runtime: 'native', state: 'stopped' };
  try {
    return await requestNativeControl(
      nativeAddress(nativeDataDirectory(root, config)),
      record,
      'status',
    );
  } catch {
    return { runtime: 'native', state: 'unreachable' };
  }
}
async function logFile(
  root: string,
): Promise<Awaited<ReturnType<typeof open>>> {
  await ensureDirectory(root);
  const path = join(root, 'native.log');
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error('Use um log nativo regular, sem link simbólico.');
    if (info.size > 5_242_880) {
      const previous = join(root, 'native.log.1');
      try {
        const older = await lstat(previous);
        if (!older.isFile() || older.isSymbolicLink())
          throw new Error('Backup de log inválido.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await rename(path, previous);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return open(path, 'a', 0o600);
}
export async function startNative(
  root: string,
  config: Installation,
  packageRoot: string,
): Promise<NativeStatus> {
  const existing = await nativeStatus(root, config);
  if (existing.state === 'running') {
    if (existing.port !== config.port)
      throw new Error('Pare o servidor antes de mudar sua porta.');
    return existing;
  }
  const output = await logFile(root);
  const child = spawn(
    process.execPath,
    [
      join(packageRoot, 'dist/native-server.mjs'),
      '--state',
      root,
      '--package',
      packageRoot,
    ],
    {
      detached: true,
      windowsHide: true,
      cwd: root,
      env: { ...process.env, NODE_OPTIONS: '' },
      stdio: ['ignore', output.fd, output.fd],
    },
  );
  let spawnError = false;
  child.once('error', () => {
    spawnError = true;
  });
  child.unref();
  await output.close();
  for (let attempt = 0; attempt < 150; attempt++) {
    const status = await nativeStatus(root, config);
    if (status.state === 'running') return status;
    if (spawnError || child.exitCode !== null) break;
    await delay(100);
  }
  throw new Error(
    'Não foi possível confirmar o início nativo. Consulte flow-batch logs e status; nenhum processo foi encerrado à força.',
  );
}
export async function stopNative(
  root: string,
  config: Installation,
): Promise<{ runtime: 'native'; state: 'stopped' }> {
  const record = await readNativeRecord(root);
  if (!record) return { runtime: 'native', state: 'stopped' };
  const address = nativeAddress(nativeDataDirectory(root, config));
  await requestNativeControl(address, record, 'stop');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!(await readNativeRecord(root)))
      return { runtime: 'native', state: 'stopped' };
    await delay(100);
  }
  throw new Error(
    'Encerramento ainda não confirmado. Consulte status e logs; os dados foram preservados.',
  );
}
export async function nativeLogs(root: string): Promise<string> {
  const file = join(root, 'native.log');
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error('Log nativo inválido.');
    const stream = await open(file, 'r');
    try {
      const bytes = Buffer.alloc(Math.min(info.size, 262144));
      await stream.read(
        bytes,
        0,
        bytes.length,
        Math.max(0, info.size - bytes.length),
      );
      return bytes
        .toString('utf8')
        .trimEnd()
        .split('\n')
        .slice(-100)
        .join('\n');
    } finally {
      await stream.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}
