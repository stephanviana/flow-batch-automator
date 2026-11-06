import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { regularFile } from '../mcp/install-files.js';
import type { Installation } from './config.js';

export const nativeRecordSchema = z.strictObject({
  version: z.literal(1),
  instanceId: z.uuid(),
  secret: z.string().regex(/^[a-f0-9]{64}$/),
  pid: z.number().int().positive(),
  port: z.number().int().min(1024).max(65535),
  startedAt: z.number().int().positive(),
});
export type NativeRecord = z.infer<typeof nativeRecordSchema>;
export const nativeStatusSchema = z.strictObject({
  runtime: z.literal('native'),
  state: z.enum(['starting', 'running', 'stopping']),
  instanceId: z.uuid(),
  pid: z.number().int().positive(),
  port: z.number().int().min(1024).max(65535),
  startedAt: z.number().int().positive(),
});
export type NativeStatus = z.infer<typeof nativeStatusSchema>;
export function nativeDataDirectory(
  root: string,
  config: Installation,
): string {
  return config.dataDirectory ?? join(root, 'data');
}
export function nativeAddress(
  dataDirectory: string,
  platform = process.platform,
): string {
  const path = resolve(dataDirectory);
  const identity = createHash('sha256')
    .update(platform === 'win32' ? path.toLowerCase() : path)
    .digest('hex');
  return platform === 'win32'
    ? `\\\\.\\pipe\\flow-batch-${identity}`
    : `\0flow-batch-${identity}`;
}
export async function readNativeRecord(
  root: string,
): Promise<NativeRecord | null> {
  const contents = await regularFile(join(root, 'native.json'));
  return contents
    ? nativeRecordSchema.parse(JSON.parse(contents.toString('utf8')))
    : null;
}
