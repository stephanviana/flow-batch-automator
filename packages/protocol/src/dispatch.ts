import { z } from 'zod';
import {
  importManifestSchema,
  importTakeSchema,
  importImageCount,
} from './imports.js';

const path = importTakeSchema.shape.reference;
export const dispatchCommandSchema = z
  .strictObject({
    version: z.literal(1),
    id: z.uuid(),
    clientId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    source: z.literal('managed'),
    manifest: importManifestSchema,
    references: z
      .array(
        z.strictObject({
          path,
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          size: z.number().int().min(1).max(8_388_608),
        }),
      )
      .min(1)
      .max(20),
    authorization: z.strictObject({
      approvedAt: z.number().int().positive(),
      expiresAt: z.number().int().positive(),
      imageGenerations: z.number().int().min(1).max(20),
      videoGenerations: z.number().int().min(1).max(20),
    }),
  })
  .superRefine((command, context) => {
    const { authorization, references, manifest } = command;
    const paths = new Set(references.map((ref) => ref.path));
    const required = new Set(manifest.tasks.map((task) => task.reference));
    if (
      authorization.expiresAt <= authorization.approvedAt ||
      authorization.expiresAt - authorization.approvedAt > 86_400_000 ||
      authorization.imageGenerations !== importImageCount(manifest) ||
      authorization.videoGenerations !== manifest.tasks.length ||
      paths.size !== references.length ||
      paths.size !== required.size ||
      [...required].some((path) => !paths.has(path))
    )
      context.addIssue({
        code: 'custom',
        message:
          'Authorization must cover the exact immutable materials for at most 24 hours',
      });
  });
export type DispatchCommand = z.infer<typeof dispatchCommandSchema>;
export const dispatchRecordSchema = z.strictObject({
  command: dispatchCommandSchema,
  state: z.enum(['pending', 'queued', 'blocked']),
  message: z.string().max(300),
});
export const dispatchListSchema = z.strictObject({
  commands: z.array(dispatchRecordSchema).max(100),
});
export const dispatchUpdateSchema = z.strictObject({
  id: z.uuid(),
  state: z.enum(['pending', 'queued', 'blocked']),
  message: z.string().max(300),
});
export type DispatchRecord = z.infer<typeof dispatchRecordSchema>;
