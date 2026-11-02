import { z } from 'zod';
import { flowDraftSchema, originalPromptsSchema } from './flow.js';
import { imageSelectionSchema, flowVideoModelSchema } from './flow-models.js';
import { enqueueSchema, inputReferenceSchema } from './queue.js';
import { flowFilenameSchema } from './flow-output.js';

export const IMPORT_FILE_LIMIT = 262_144;
export const QUEUE_BODY_LIMIT = 65_536;
export const importTakeSchema = z.strictObject({
  id: z.uuid(),
  product: flowDraftSchema.shape.product,
  video: flowDraftSchema.shape.video,
  take: flowDraftSchema.shape.take,
  reference: inputReferenceSchema.shape.relativePath,
  original: originalPromptsSchema.refine(
    (prompts) =>
      prompts.imagePrompt.trim().length > 0 &&
      prompts.videoPrompt.trim().length > 0,
  ),
  imageModel: imageSelectionSchema.default('GEM_PIX_2'),
  videoModel: flowVideoModelSchema.default('abra_i2v_8s'),
  aspect: flowDraftSchema.shape.aspect.default('9:16'),
  reuseImageFrom: z.uuid().optional(),
  output: z
    .strictObject({ groupId: z.uuid(), filename: flowFilenameSchema })
    .optional(),
});
export const importManifestSchema = z
  .strictObject({
    version: z.literal(1),
    id: z.uuid(),
    tasks: z.array(importTakeSchema).min(1).max(20),
  })
  .refine(
    (manifest) =>
      new Set(manifest.tasks.map((take) => take.id)).size ===
      manifest.tasks.length,
    'Cada take deve ter um id distinto.',
  )
  .superRefine((manifest, context) => {
    const names = new Set<string>();
    for (const [index, take] of manifest.tasks.entries()) {
      if (take.reuseImageFrom) {
        const source = manifest.tasks
          .slice(0, index)
          .find((entry) => entry.id === take.reuseImageFrom);
        if (
          !source ||
          source.reuseImageFrom ||
          source.product !== take.product ||
          source.video !== take.video ||
          source.reference !== take.reference ||
          source.original.imagePrompt !== take.original.imagePrompt ||
          source.imageModel !== take.imageModel ||
          source.aspect !== take.aspect ||
          source.output?.groupId !== take.output?.groupId
        )
          context.addIssue({
            code: 'custom',
            path: ['tasks', index, 'reuseImageFrom'],
            message:
              'Reused image must come from an earlier generating take in this variation with identical visual materials',
          });
      }
      if (take.output) {
        const key = `${take.output.groupId}/${take.output.filename.toLowerCase()}`;
        if (names.has(key))
          context.addIssue({
            code: 'custom',
            path: ['tasks', index, 'output'],
            message: 'Output filenames must be unique per variation',
          });
        names.add(key);
      }
    }
  });
export type ImportManifest = z.infer<typeof importManifestSchema>;
export function importImageCount(manifest: ImportManifest): number {
  return manifest.tasks.filter((take) => !take.reuseImageFrom).length;
}
export const approvedImportSchema = enqueueSchema.refine((input) => {
  const first = input.tasks[0];
  return (
    first?.executor === 'google-flow' &&
    Boolean(first.flow.batchId) &&
    input.tasks.every(
      (task) =>
        task.executor === 'google-flow' &&
        task.flow.batchId === first.flow.batchId &&
        task.flow.projectId === first.flow.projectId,
    )
  );
}, 'A importação deve conter apenas takes reais de um mesmo lote e projeto.');
export type ApprovedImport = z.infer<typeof approvedImportSchema>;
