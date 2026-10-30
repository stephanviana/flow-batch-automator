import { z } from 'zod';

const batchName = z.string().trim().min(1).max(120);
export const batchDraftSchema = z.strictObject({
  id: z.uuid(),
  name: batchName,
  mode: z.enum(['new-project', 'existing-project']),
});
export const batchSchema = z.strictObject({
  ...batchDraftSchema.shape,
  status: z.enum(['draft', 'creating', 'ready', 'uncertain']),
  projectId: z.uuid().nullable(),
  projectTitle: z.string().max(160).nullable(),
  revision: z.number().int().nonnegative(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Batch = z.infer<typeof batchSchema>;
export const batchListSchema = z.strictObject({
  batches: z.array(batchSchema),
});
const revision = z.number().int().nonnegative();
export const batchActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('prepare'), draft: batchDraftSchema }),
  z.strictObject({
    action: z.literal('claim'),
    id: z.uuid(),
    expectedRevision: revision,
  }),
  z
    .strictObject({
      action: z.literal('settle'),
      id: z.uuid(),
      attemptId: z.uuid(),
      outcome: z.enum(['ready', 'not-created', 'uncertain']),
      projectId: z.uuid().optional(),
      projectTitle: z.string().max(160).optional(),
    })
    .refine(
      (input) => (input.outcome === 'ready') === Boolean(input.projectId),
    ),
  z.strictObject({
    action: z.literal('attach'),
    id: z.uuid(),
    expectedRevision: revision,
    projectId: z.uuid(),
  }),
]);
export type BatchAction = z.infer<typeof batchActionSchema>;
export const batchActionReplySchema = z.strictObject({
  batch: batchSchema,
  attemptId: z.uuid().optional(),
});
