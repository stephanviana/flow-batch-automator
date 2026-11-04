import { z } from 'zod';

export const MATERIAL_LIMIT = 8_388_608;
export const VIDEO_MATERIAL_LIMIT = 67_108_864;
const materialExtensions = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/json': 'json',
  'video/mp4': 'mp4',
} as const;
export const materialSchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string().min(1).max(180),
    mime: z.enum(
      Object.keys(materialExtensions) as [
        keyof typeof materialExtensions,
        ...(keyof typeof materialExtensions)[],
      ],
    ),
    size: z.number().int().min(1).max(VIDEO_MATERIAL_LIMIT),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    available: z.boolean(),
  })
  .refine(
    (material) =>
      material.mime === 'video/mp4' || material.size <= MATERIAL_LIMIT,
    'Imagens e documentos devem ter até 8 MB.',
  );
export type Material = z.infer<typeof materialSchema>;

export function materialFilename(
  material: Pick<Material, 'id' | 'mime'>,
): string {
  return `${material.id}.${materialExtensions[material.mime]}`;
}
