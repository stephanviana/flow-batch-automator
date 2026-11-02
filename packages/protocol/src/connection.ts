import { z } from 'zod';
import {
  flowInspectionSchema,
  flowExecuteSchema,
  queueCheckpointSchema,
} from './flow.js';
import {
  queueExecuteSchema,
  queueProgressSchema,
  queueSnapshotSchema,
  taskDetailSchema,
} from './queue.js';

export const extensionIdSchema = z.string().regex(/^[a-p]{32}$/);
export const publicKeySchema = z.strictObject({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  y: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const pairingRequestSchema = z.strictObject({
  publicKey: publicKeySchema,
});
export const pairingReceiptSchema = z.strictObject({
  requestId: z.uuid(),
  clientId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
  expiresAt: z.number(),
});
export const challengeRequestSchema = z.strictObject({
  clientId: z.uuid(),
  method: z.enum(['GET', 'POST']),
  target: z.enum([
    '/api/identity',
    '/api/batches',
    '/api/dispatch',
    '/api/materials',
    '/api/simulations',
    '/api/queue',
    '/api/queue/control',
    '/api/queue/actions',
    '/api/queue/task',
    '/ws',
  ]),
  bodyDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export const challengeSchema = challengeRequestSchema.extend({
  challengeId: z.uuid(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  authority: z.string().max(100),
  expiresAt: z.number(),
});
export type Challenge = z.infer<typeof challengeSchema>;
export type PublicKey = z.infer<typeof publicKeySchema>;
export type PairingReceipt = z.infer<typeof pairingReceiptSchema>;

// Explicit version and fixed ordered components; not an RFC 9421 wire encoding.
export function signaturePayload(challenge: Challenge): string {
  return JSON.stringify([
    'flow-batch-signature-v1',
    challenge.clientId,
    challenge.challengeId,
    challenge.nonce,
    challenge.method,
    challenge.authority,
    challenge.target,
    challenge.bodyDigest,
  ]);
}

export const simulationRequestSchema = z.strictObject({
  requestId: z.uuid(),
  durationMs: z.number().int().min(100).max(15000),
});
export const simulationStateSchema = z.enum([
  'sent',
  'running',
  'completed',
  'interrupted',
]);
export const simulationSchema = z.strictObject({
  id: z.uuid(),
  requestId: z.uuid(),
  state: simulationStateSchema,
  durationMs: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  events: z.array(
    z.strictObject({
      state: simulationStateSchema,
      at: z.number(),
      reason: z.string(),
    }),
  ),
});
export type Simulation = z.infer<typeof simulationSchema>;
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('authenticate'),
    clientId: z.uuid(),
    challengeId: z.uuid(),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
    protocolVersion: z
      .union([z.literal(3), z.literal(4), z.literal(5)])
      .optional(),
  }),
  z.strictObject({ type: z.literal('ping') }),
  z.strictObject({ type: z.literal('simulation-started'), id: z.uuid() }),
  z.strictObject({ type: z.literal('simulation-completed'), id: z.uuid() }),
  queueProgressSchema,
  queueCheckpointSchema,
]);
export const serverMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('authenticated') }),
  z.strictObject({ type: z.literal('pong') }),
  z.strictObject({ type: z.literal('revoked') }),
  queueExecuteSchema,
  flowExecuteSchema,
  z.strictObject({
    type: z.literal('simulate'),
    id: z.uuid(),
    durationMs: z.number().int().min(100).max(15000),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export const popupRequestSchema = z.strictObject({
  type: z.enum([
    'status',
    'flow-open',
    'flow-inspect',
    'connect',
    'disconnect',
    'reconnect',
    'simulate',
    'enqueue-demo',
    'enqueue-retry-demo',
    'enqueue-stall-demo',
    'queue-start',
    'queue-pause',
    'queue-retry',
    'queue-resolve',
    'queue-cancel',
    'queue-inspect',
    'queue-show-download',
  ]),
  note: z.string().trim().min(1).max(500).optional(),
  reviewOutcome: z.enum(['not_submitted', 'failed']).optional(),
  taskId: z.uuid().optional(),
  expectedRevision: z.number().int().min(0).optional(),
});
export type PopupRequest = z.infer<typeof popupRequestSchema>;
export const extensionStateSchema = z.strictObject({
  phase: z.enum([
    'disconnected',
    'pending',
    'connecting',
    'connected',
    'reconnecting',
    'revoked',
    'error',
  ]),
  message: z.string().max(200),
  code: z.string().optional(),
  expiresAt: z.number().optional(),
});
export const popupReplySchema = z.strictObject({
  state: extensionStateSchema,
  simulations: z.array(simulationSchema),
  queue: queueSnapshotSchema.nullable(),
  inspection: taskDetailSchema.nullable(),
  operationError: z.string().nullable(),
  flow: flowInspectionSchema.nullable(),
});
export type ExtensionState = z.infer<typeof extensionStateSchema>;
