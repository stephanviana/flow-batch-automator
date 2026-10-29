import { createApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const app = createApp(config);
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      process.exit(1);
    }, 8000).unref();
    try {
      await app.close();
    } catch {
      process.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  };
  process.once('SIGTERM', () => {
    void stop();
  });
  process.once('SIGINT', () => {
    void stop();
  });
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch {
    await stop();
    throw new Error('HTTP startup failed');
  }
}

main().catch((): void => {
  console.error(
    'Orchestrator startup failed. Check configuration, port and SQLite volume permissions.',
  );
  process.exitCode = 1;
});
