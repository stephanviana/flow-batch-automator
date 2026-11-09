import { z } from 'zod';

export const PREPARATION_CONTRACT = 'flow-orders/5';
export const libraryFileSchema = z
  .string()
  .max(180)
  .regex(
    /^(?:(?:biblioteca|base)\.md|(instrucoes|formatos|fluxos|swipes)\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(md|txt|json))$/,
  )
  .refine((path) => !path.split('/').some((part) => part.startsWith('.')));
export const instructionFileSchema = libraryFileSchema.refine(
  (path) =>
    ['biblioteca.md', 'base.md'].includes(path) ||
    /^(instrucoes|formatos)\//.test(path),
  'Use somente arquivos de instruções.',
);
export const libraryFilesSchema = z
  .record(libraryFileSchema, z.string().max(8_388_608))
  .refine((files) =>
    Object.entries(files).every(
      ([path, text]) =>
        path === 'biblioteca.md' ||
        (path === 'base.md' || path.startsWith('formatos/')
          ? new TextEncoder().encode(text).length <= 1_048_576
          : text.length <= 262144),
    ),
  )
  .refine((files) => Object.keys(files).length <= 128)
  .refine(
    (files) =>
      Object.values(files).reduce(
        (sum, text) => sum + new TextEncoder().encode(text).length,
        0,
      ) <= 8_388_608,
  );
export const libraryRevisionSchema = z.strictObject({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  libraryId: z.uuid(),
  createdAt: z.number().int().positive(),
  message: z.string().max(500),
  files: libraryFilesSchema,
});
export const libraryBackupSchema = z.strictObject({
  version: z.literal(1),
  libraryId: z.uuid(),
  current: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  revisions: z.array(libraryRevisionSchema).max(500),
  draft: libraryFilesSchema,
});
export type LibraryFiles = z.infer<typeof libraryFilesSchema>;
export type LibraryRevision = z.infer<typeof libraryRevisionSchema>;
export type LibraryBackup = z.infer<typeof libraryBackupSchema>;
