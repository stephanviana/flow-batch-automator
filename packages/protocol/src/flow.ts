import { z } from 'zod';

export const flowInspectionSchema = z.strictObject({
  phase: z.enum(['no-tab', 'not-ready', 'ready', 'error']),
  message: z.string().max(240),
  projectId: z.string().max(128).nullable(),
  checkedAt: z.number().int().nonnegative(),
});
export type FlowInspection = z.infer<typeof flowInspectionSchema>;
