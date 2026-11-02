import { resolve, dirname } from 'node:path';
import { z } from 'zod';
import { DEFAULT_PORT } from '@flow-batch/protocol';

const configSchema = z.object({
  HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(DEFAULT_PORT),
  DATABASE_PATH: z.string().min(1).default('./data/flow-batch.sqlite'),
  MATERIALS_DIR: z.string().min(1).optional(),
  SQLITE_BUSY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(10000)
    .default(3000),
  LOG_LEVEL: z
    .enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug'])
    .default('info'),
});

export interface AppConfig {
  host: '127.0.0.1' | '0.0.0.0';
  port: number;
  databasePath: string;
  materialsDirectory: string;
  busyTimeoutMs: number;
  logLevel: z.infer<typeof configSchema>['LOG_LEVEL'];
}

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const parsed = configSchema.safeParse(environment);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join('.'))),
    ];
    throw new Error(`Invalid configuration fields: ${fields.join(', ')}`);
  }
  const config = parsed.data;
  if (config.DATABASE_PATH === ':memory:') {
    throw new Error('DATABASE_PATH must refer to a persistent file');
  }
  const databasePath = resolve(config.DATABASE_PATH);
  const materialsDirectory = resolve(
    config.MATERIALS_DIR ?? resolve(dirname(databasePath), 'materials'),
  );
  return {
    host: config.HOST,
    port: config.PORT,
    databasePath,
    materialsDirectory,
    busyTimeoutMs: config.SQLITE_BUSY_TIMEOUT_MS,
    logLevel: config.LOG_LEVEL,
  };
}
