import { referenceFileSchema } from '@flow-batch/protocol';
import type { z } from 'zod';

async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return btoa(chunks.join(''));
}

export function validateReferenceFile(
  file: File,
): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (!file.size || file.size > 8_388_608)
    throw new Error('Selecione uma imagem de referência de até 8 MB.');
  const mime =
    file.type ||
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
    }[file.name.split('.').pop()?.toLowerCase() ?? ''];
  return referenceFileSchema.shape.mime.parse(mime);
}

export async function readReferenceFile(
  file: File,
): Promise<z.infer<typeof referenceFileSchema>> {
  const mime = validateReferenceFile(file);
  return referenceFileSchema.parse({
    name: file.name,
    mime,
    base64: await fileBase64(file),
  });
}
