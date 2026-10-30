import { z } from 'zod';
import {
  flowSettingsSchema,
  flowResultSchema,
  flowStageSchema,
  queueCheckpointSchema,
  originalPromptsSchema,
  type FlowExecute,
} from './flow.js';

export const taskStateSchema = z.enum([
  'queued',
  'dispatching',
  'submitted',
  'generating',
  'download_pending',
  'completed',
  'failed',
  'uncertain',
  'cancelled',
]);
export type TaskState = z.infer<typeof taskStateSchema>;
export const ACTIVE_TASK_STATES: readonly TaskState[] = [
  'dispatching',
  'submitted',
  'generating',
  'download_pending',
];
const transitions: Record<TaskState, readonly TaskState[]> = {
  queued: ['dispatching', 'cancelled'],
  dispatching: ['submitted', 'failed', 'uncertain'],
  submitted: ['generating', 'failed', 'uncertain'],
  generating: ['download_pending', 'failed', 'uncertain'],
  download_pending: ['completed', 'failed', 'uncertain'],
  completed: [],
  failed: ['queued'],
  uncertain: ['failed', 'completed'],
  cancelled: [],
};
export function canTransitionTask(from: TaskState, to: TaskState): boolean {
  return transitions[from].includes(to);
}

const inputReferenceSchema = z.strictObject({
  root: z.literal('inputs'),
  relativePath: z
    .string()
    .min(1)
    .max(512)
    .refine(
      (path) =>
        !/[\\:]/.test(path) &&
        !path.includes(String.fromCharCode(0)) &&
        !path.startsWith('/') &&
        path
          .split('/')
          .every(
            (segment) => segment !== '' && segment !== '.' && segment !== '..',
          ),
      'Expected a path relative to inputs',
    ),
});
export const queueSimulationSchema = z.strictObject({
  durationMs: z.number().int().min(100).max(15000),
  scenario: z.enum([
    'success',
    'transient_before_submit',
    'permanent_before_submit',
    'failure_after_submit',
    'stall_after_submit',
  ]),
  failAttempts: z.number().int().min(1).max(5).default(1),
});
const taskBaseSchema = z.strictObject({
  taskKey: z.uuid(),
  product: z.string().min(1).max(120),
  video: z.string().min(1).max(120),
  format: z.string().min(1).max(80),
  take: z.string().min(1).max(80),
  references: z.array(inputReferenceSchema).max(10),
  original: originalPromptsSchema,
});
export const taskInputSchema = z.discriminatedUnion('executor', [
  taskBaseSchema.extend({
    executor: z.literal('simulation'),
    simulation: queueSimulationSchema,
    maxAttempts: z.number().int().min(1).max(5).default(3),
  }),
  taskBaseSchema
    .extend({
      executor: z.literal('google-flow'),
      flow: flowSettingsSchema,
      maxAttempts: z.literal(1).default(1),
    })
    .refine(
      (input) =>
        input.references.length === 0 &&
        input.original.imagePrompt.trim().length > 0 &&
        input.original.videoPrompt.trim().length > 0 &&
        input.format === input.flow.aspect,
    ),
]);
export type TaskInput = z.infer<typeof taskInputSchema>;
export const enqueueSchema = z
  .strictObject({
    requestId: z.uuid(),
    tasks: z.array(taskInputSchema).min(1).max(20),
  })
  .refine(
    (batch) =>
      new Set(batch.tasks.map((task) => task.taskKey)).size ===
      batch.tasks.length,
    'Repeated task keys in batch',
  );
export const queueErrorSchema = z.strictObject({
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(200),
  retryable: z.boolean(),
  notSubmitted: z.boolean(),
});
const simulationResultSchema = z.strictObject({
  simulated: z.literal(true),
  outputFile: z.null(),
  description: z.string().min(1).max(200),
});
export const queueResultSchema = z.discriminatedUnion('simulated', [
  simulationResultSchema,
  flowResultSchema,
]);
export const queueProgressSchema = z.discriminatedUnion('state', [
  z.strictObject({
    type: z.literal('queue-progress'),
    taskId: z.uuid(),
    attemptId: z.uuid(),
    state: z.enum(['submitted', 'generating', 'download_pending']),
    generationId: z.string().regex(/^(?:sim|flow)-[a-f0-9-]{36}$/),
  }),
  z.strictObject({
    type: z.literal('queue-progress'),
    taskId: z.uuid(),
    attemptId: z.uuid(),
    state: z.literal('completed'),
    generationId: z.string().regex(/^(?:sim|flow)-[a-f0-9-]{36}$/),
    result: queueResultSchema,
  }),
  z.strictObject({
    type: z.literal('queue-progress'),
    taskId: z.uuid(),
    attemptId: z.uuid(),
    state: z.enum(['failed', 'uncertain']),
    error: queueErrorSchema,
  }),
]);
export type QueueProgress = z.infer<typeof queueProgressSchema>;
export const queueExecuteSchema = z.strictObject({
  type: z.literal('queue-execute'),
  taskId: z.uuid(),
  attemptId: z.uuid(),
  attemptNumber: z.number().int().min(1).max(5),
  simulation: queueSimulationSchema,
});
export type SimulationExecute = z.infer<typeof queueExecuteSchema>;
export type QueueExecute = SimulationExecute | FlowExecute;
export const queueActionSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('retry'),
    requestId: z.uuid(),
    taskId: z.uuid(),
    expectedRevision: z.number().int().min(0),
    acknowledgeDuplicateRisk: z.boolean().default(false),
  }),
  z.strictObject({
    action: z.literal('cancel'),
    requestId: z.uuid(),
    taskId: z.uuid(),
    expectedRevision: z.number().int().min(0),
  }),
  z.strictObject({
    action: z.literal('resolve'),
    requestId: z.uuid(),
    taskId: z.uuid(),
    expectedRevision: z.number().int().min(0),
    outcome: z.enum(['not_submitted', 'failed', 'completed']),
    note: z.string().trim().min(1).max(500),
  }),
]);
export type QueueAction = z.infer<typeof queueActionSchema>;
export const taskSummarySchema = z.strictObject({
  batchId: z.uuid().optional(),
  batchName: z.string().optional(),
  id: z.uuid(),
  taskKey: z.uuid(),
  executor: z.enum(['simulation', 'google-flow']),
  step: flowStageSchema.nullable(),
  product: z.string(),
  video: z.string(),
  format: z.string(),
  take: z.string(),
  state: taskStateSchema,
  attemptCount: z.number().int(),
  maxAttempts: z.number().int(),
  revision: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
  nextAttemptAt: z.number(),
  generationId: z.string().nullable(),
  safeToRetry: z.boolean(),
  result: queueResultSchema.nullable(),
  lastError: queueErrorSchema.nullable(),
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;
export const taskEventSchema = z.strictObject({
  state: taskStateSchema,
  at: z.number(),
  attemptId: z.uuid().nullable(),
  reason: z.string(),
  error: queueErrorSchema.nullable(),
});
export const taskDetailSchema = z.strictObject({
  task: taskSummarySchema,
  input: taskInputSchema,
  attempts: z.array(
    z.strictObject({
      id: z.uuid(),
      number: z.number(),
      connectionId: z.uuid(),
      startedAt: z.number(),
      finishedAt: z.number().nullable(),
      state: taskStateSchema,
      generationId: z.string().nullable(),
      error: queueErrorSchema.nullable(),
    }),
  ),
  events: z.array(taskEventSchema),
  checkpoints: z.array(
    z.strictObject({ at: z.number(), checkpoint: queueCheckpointSchema }),
  ),
});
export type TaskDetail = z.infer<typeof taskDetailSchema>;
export const queueSnapshotSchema = z.strictObject({
  running: z.boolean(),
  blockedByReview: z.boolean(),
  tasks: z.array(taskSummarySchema),
  counts: z.record(taskStateSchema, z.number().int().min(0)),
});
export type QueueSnapshot = z.infer<typeof queueSnapshotSchema>;
