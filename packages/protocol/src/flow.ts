import { z } from 'zod';

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
export const flowSettingsSchema = z.strictObject({
  projectId: z.uuid(),
  imageModel: z.enum(['GEM_PIX_2', 'BELUGA', 'HARBOR_SEAL']),
  videoModel: z.enum([
    'veo_3_1_i2v_lite',
    'veo_3_1_i2v_lite_low_priority',
    'veo_3_1_i2v_s_fast_ultra',
  ]),
  aspect: z.enum(['9:16', '16:9']),
  seed: z.number().int().min(1).max(1_000_000_000),
  reference: flowReferenceSchema,
  approval: z.strictObject({
    approvedAt: z.number().int().positive(),
    imageGenerations: z.literal(1),
    videoGenerations: z.literal(1),
  }),
});
export type FlowSettings = z.infer<typeof flowSettingsSchema>;
export const flowDraftSchema = z.strictObject({
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
  imageModel: flowSettingsSchema.shape.imageModel,
  videoModel: flowSettingsSchema.shape.videoModel,
  aspect: flowSettingsSchema.shape.aspect,
  seed: flowSettingsSchema.shape.seed,
  approval: flowSettingsSchema.shape.approval,
  reference: referenceFileSchema,
});
export type FlowDraft = z.infer<typeof flowDraftSchema>;
export const flowExecuteSchema = z.strictObject({
  type: z.literal('flow-execute'),
  taskId: z.uuid(),
  attemptId: z.uuid(),
  attemptNumber: z.literal(1),
  flow: flowSettingsSchema,
  original: originalPromptsSchema,
});
export type FlowExecute = z.infer<typeof flowExecuteSchema>;
const checkpointBase = z.strictObject({
  type: z.literal('queue-checkpoint'),
  taskId: z.uuid(),
  attemptId: z.uuid(),
});
export const queueCheckpointSchema = z.discriminatedUnion('stage', [
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
  outputFile: z.string().regex(/^FlowBatch\/[a-f0-9-]{36}\/take\.mp4$/),
  downloadId: z.number().int().min(0),
  imageMediaId: flowIdSchema,
  videoMediaId: flowIdSchema,
  operationId: flowIdSchema,
  description: z.string().min(1).max(200),
});
