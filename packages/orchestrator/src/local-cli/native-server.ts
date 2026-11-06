import { randomBytes, randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import {
  atomicReplace,
  ensureDirectory,
  regularFile,
} from '../mcp/install-files.js';
import { requireInstallation } from './config.js';
import {
  nativeAddress,
  nativeDataDirectory,
  type NativeRecord,
  type NativeStatus,
} from './native-state.js';
import { listenNativeControl } from './native-control.js';
import { runProcess } from './process.js';

async function checkPort(port: number): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}
async function serve(root: string, packageRoot: string): Promise<void> {
  const config = await requireInstallation(root);
  if (config.runtime !== 'native')
    throw new Error('Native runtime not configured');
  const data = nativeDataDirectory(root, config);
  const record: NativeRecord = {
    version: 1,
    instanceId: randomUUID(),
    secret: randomBytes(32).toString('hex'),
    pid: process.pid,
    port: config.port,
    startedAt: Date.now(),
  };
  let state: NativeStatus['state'] = 'starting';
  const status = (): NativeStatus => ({
    runtime: 'native',
    state,
    instanceId: record.instanceId,
    pid: record.pid,
    port: record.port,
    startedAt: record.startedAt,
  });
  let app: ReturnType<typeof createApp> | undefined;
  let startup: Promise<void> = Promise.resolve();
  const stop = async (): Promise<void> => {
    if (state === 'stopping') return;
    state = 'stopping';
    const deadline = setTimeout(() => process.exit(1), 10000).unref();
    await startup.catch(() => {});
    try {
      await app?.close();
      const file = join(root, 'native.json');
      const contents = await regularFile(file);
      if (contents?.equals(Buffer.from(JSON.stringify(record) + '\n')))
        await unlink(file);
    } catch {
      process.exitCode = 1;
    } finally {
      await new Promise<void>((resolve) => control.close(() => resolve()));
      clearTimeout(deadline);
    }
  };
  const control = await listenNativeControl(
    nativeAddress(data),
    record,
    status,
    () => {
      void stop();
    },
  );
  process.once('SIGTERM', () => {
    void stop();
  });
  process.once('SIGINT', () => {
    void stop();
  });
  startup = (async (): Promise<void> => {
    const file = join(root, 'native.json');
    await atomicReplace(
      file,
      Buffer.from(JSON.stringify(record) + '\n'),
      await regularFile(file),
    );
    await checkPort(config.port);
    if (status().state === 'stopping') return;
    const sync = await runProcess(process.execPath, [
      join(packageRoot, 'runtime/sync-extension.mjs'),
      join(packageRoot, 'runtime/extension'),
      config.extensionDirectory,
    ]);
    if (sync.code) throw new Error('Extension sync failed');
    if (status().state === 'stopping') return;
    await ensureDirectory(data);
    app = createApp(
      loadConfig({
        HOST: '127.0.0.1',
        PORT: String(config.port),
        DATABASE_PATH: join(data, 'flow-batch.sqlite'),
        MATERIALS_DIR: join(data, 'materials'),
        LIBRARY_DIR: config.libraryDirectory,
        LOG_LEVEL: 'info',
      }),
    );
    await app.listen({ host: '127.0.0.1', port: config.port });
    if (status().state !== 'stopping') state = 'running';
  })();
  try {
    await startup;
  } catch (error) {
    await stop();
    throw error;
  }
}
const { values } = parseArgs({
  options: { state: { type: 'string' }, package: { type: 'string' } },
});
if (!values.state || !values.package)
  throw new Error('Use the flow-batch CLI to start the native runtime.');
serve(values.state, values.package).catch((error: unknown) => {
  const code = (error as NodeJS.ErrnoException).code;
  console.error(
    `Native startup failed${code ? ` (${code})` : ''}. Check the port, data permissions and extension destination.`,
  );
  process.exitCode = 1;
});
