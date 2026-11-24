import { z } from 'zod';
import { flowIdSchema } from './flow.js';

export const flowRevisionContentSchema = z
  .strictObject({
    copy: z.string().trim().min(1).max(4096),
    videoPrompt: z.string().trim().min(1).max(4096),
    reason: z.string().trim().min(1).max(1000),
  })
  .refine(
    ({ copy, videoPrompt }) => videoPrompt.includes(copy),
    'O prompt deve conter a fala exata da versão revisada.',
  );

export const flowRevisionPreparationSchema = z.strictObject({
  requestId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  content: flowRevisionContentSchema,
});
export const flowRevisionSubmissionSchema =
  flowRevisionPreparationSchema.extend({
    execution: z
      .strictObject({
        userAuthorized: z.literal(true),
        startQueue: z.boolean().default(true),
      })
      .optional(),
  });
export const flowRevisionApprovalSchema = z.strictObject({
  revisionId: z.uuid(),
  userAuthorized: z.literal(true),
  startQueue: z.boolean().default(false),
});
export const flowTakeRevisionSchema = z.strictObject({
  id: z.uuid(),
  taskId: z.uuid(),
  baseAttemptId: z.uuid(),
  taskRevision: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  content: flowRevisionContentSchema,
  sourceImage: z.strictObject({ taskId: z.uuid(), mediaId: flowIdSchema }),
  createdAt: z.number().int().nonnegative(),
  approvedAt: z.number().int().nonnegative().nullable(),
  attemptNumber: z.number().int().positive().nullable(),
});
export type FlowRevisionContent = z.infer<typeof flowRevisionContentSchema>;
export type FlowTakeRevision = z.infer<typeof flowTakeRevisionSchema>;
export type FlowRevisionPreparation = z.infer<
  typeof flowRevisionPreparationSchema
>;
export type FlowRevisionSubmission = z.infer<
  typeof flowRevisionSubmissionSchema
>;
export type FlowRevisionApproval = z.infer<typeof flowRevisionApprovalSchema>;
