import { z } from 'zod';
export * from './connection.js';
export * from './queue.js';
export * from './flow.js';
export * from './flow-output.js';
export * from './flow-models.js';
export * from './batches.js';

export const DEFAULT_PORT = 4319;
export const LOCAL_SERVER_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

export const livenessSchema = z.strictObject({ status: z.literal('alive') });
export const readinessSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ready'),
    sqlite: z.literal('available'),
  }),
  z.strictObject({
    status: z.literal('unavailable'),
    sqlite: z.literal('unavailable'),
  }),
]);

export type Readiness = z.infer<typeof readinessSchema>;
