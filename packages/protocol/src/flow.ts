import { z } from 'zod';
import { flowVideoModelSchema, imageSelectionSchema } from './flow-models.js';
import { flowOutputSchema, flowOutputFileSchema } from './flow-output.js';

export const flowInspectionSchema = z.strictObject({
  phase: z.enum(['no-tab', 'not-ready', 'ready', 'error']),
  message: z.string().max(240),
  projectId: z.string().max(128).nullable(),
  checkedAt: z.number().int().nonnegative(),
});
export type FlowInspection = z.infer<typeof flowInspectionSchema>;

export const flowIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const flowStageSchema = z.enum([
  'reference_uploaded',
  'image_generated',
  'video_submitted',
  'video_ready',
  'download_started',
  'image_reused',
]);
export const referenceFileSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(180)
    .regex(/^[^/\\]+$/)
    .refine((name) => !name.includes(String.fromCharCode(0))),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  base64: z
    .string()
    .min(4)
    .max(11_184_812)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export const flowReferenceSchema = z.strictObject({
  assetId: z.uuid(),
  name: referenceFileSchema.shape.name,
  mime: referenceFileSchema.shape.mime,
  bytes: z.number().int().min(1).max(8_388_608),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type FlowReference = z.infer<typeof flowReferenceSchema>;
export const originalPromptsSchema = z.strictObject({
  imagePrompt: z.string().max(4096),
  videoPrompt: z.string().max(4096),
  copy: z.string().max(4096),
});
export const flowSettingsSchema = z
  .strictObject({
    batchId: z.uuid().optional(),
    projectId: z.uuid(),
    imageModel: z.enum(['GEM_PIX_2', 'BELUGA', 'HARBOR_SEAL']),
    videoModel: flowVideoModelSchema,
    aspect: z.enum(['9:16', '16:9']),
    seed: z.number().int().min(1).max(1_000_000_000),
    reference: flowReferenceSchema,
    imageSourceTaskKey: z.uuid().optional(),
    output: flowOutputSchema.optional(),
    approval: z.strictObject({
      approvedAt: z.number().int().positive(),
      imageGenerations: z.union([z.literal(0), z.literal(1)]),
      videoGenerations: z.literal(1),
    }),
  })
  .refine(
    (flow) =>
      flow.approval.imageGenerations === (flow.imageSourceTaskKey ? 0 : 1),
    'Image reuse authorizes zero new images',
  );
export type FlowSettings = z.infer<typeof flowSettingsSchema>;
export function flowCheckpointStages(
  flow: Pick<FlowSettings, 'imageSourceTaskKey'>,
): readonly z.infer<typeof flowStageSchema>[] {
  return flow.imageSourceTaskKey
    ? ['image_reused', 'video_submitted', 'video_ready', 'download_started']
    : [
        'reference_uploaded',
        'image_generated',
        'video_submitted',
        'video_ready',
        'download_started',
      ];
}
export const flowDraftSchema = z
  .strictObject({
    batchId: z.uuid().optional(),
    projectId: z.uuid(),
    requestId: z.uuid(),
    taskKey: z.uuid(),
    product: z.string().trim().min(1).max(120),
    video: z.string().trim().min(1).max(120),
    take: z.string().trim().min(1).max(80),
    original: originalPromptsSchema.refine(
      (prompts) =>
        prompts.imagePrompt.trim().length > 0 &&
        prompts.videoPrompt.trim().length > 0,
    ),
    imageModel: imageSelectionSchema,
    videoModel: flowSettingsSchema.shape.videoModel,
    aspect: flowSettingsSchema.shape.aspect,
    seed: flowSettingsSchema.shape.seed,
    approval: flowSettingsSchema.shape.approval,
    reference: referenceFileSchema,
  })
  .refine(
    (draft) => draft.approval.imageGenerations === 1,
    'Manual takes generate one image',
  );
export type FlowDraft = z.infer<typeof flowDraftSchema>;
export const flowExecuteSchema = z
  .strictObject({
    type: z.literal('flow-execute'),
    taskId: z.uuid(),
    attemptId: z.uuid(),
    attemptNumber: z.literal(1),
    flow: flowSettingsSchema,
    original: originalPromptsSchema,
    sourceImage: z
      .strictObject({ taskId: z.uuid(), mediaId: flowIdSchema })
      .optional(),
  })
  .refine(
    (command) =>
      Boolean(command.sourceImage) === Boolean(command.flow.imageSourceTaskKey),
    'Reuse requires a resolved source image',
  );
export type FlowExecute = z.infer<typeof flowExecuteSchema>;
const checkpointBase = z.strictObject({
  type: z.literal('queue-checkpoint'),
  taskId: z.uuid(),
  attemptId: z.uuid(),
});
export const queueCheckpointSchema = z.discriminatedUnion('stage', [
  checkpointBase.extend({
    stage: z.literal('image_reused'),
    mediaId: flowIdSchema,
    sourceTaskId: z.uuid(),
  }),
  checkpointBase.extend({
    stage: z.literal('reference_uploaded'),
    mediaId: flowIdSchema,
  }),
  checkpointBase.extend({
    stage: z.literal('image_generated'),
    mediaId: flowIdSchema,
  }),
  checkpointBase.extend({
    stage: z.literal('video_submitted'),
    operationId: flowIdSchema,
  }),
  checkpointBase.extend({
    stage: z.literal('video_ready'),
    mediaId: flowIdSchema,
  }),
  checkpointBase.extend({
    stage: z.literal('download_started'),
    downloadId: z.number().int().min(0),
  }),
]);
export type QueueCheckpoint = z.infer<typeof queueCheckpointSchema>;
export const flowResultSchema = z.strictObject({
  simulated: z.literal(false),
  outputFile: flowOutputFileSchema,
  downloadId: z.number().int().min(0),
  imageMediaId: flowIdSchema,
  videoMediaId: flowIdSchema,
  operationId: flowIdSchema,
  description: z.string().min(1).max(200),
});
