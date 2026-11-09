import { lstatSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { atomicWrite, readText } from './files.js';

export const METADATA_FILE = 'instrucoes.json';
const schema = z.strictObject({
  version: z.literal(1),
  libraryId: z.uuid(),
  current: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
export type InstructionMetadata = z.infer<typeof schema>;
function present(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
}
export function readMetadata(root: string): InstructionMetadata {
  return schema.parse(JSON.parse(readText(join(root, METADATA_FILE))));
}
export function initializeMetadata(root: string): boolean {
  const canonical = join(root, METADATA_FILE);
  const legacy = join(root, 'biblioteca.json');
  if (present(canonical)) {
    const current = readMetadata(root);
    if (present(legacy)) {
      const previous = schema.parse(JSON.parse(readText(legacy)));
      if (
        current.libraryId !== previous.libraryId ||
        current.current !== previous.current
      )
        throw new Error(
          'Conflito entre instrucoes.json e biblioteca.json. Preserve os arquivos e revise a identidade e a revisão.',
        );
      unlinkSync(legacy);
    }
    return false;
  }
  if (present(legacy)) {
    schema.parse(JSON.parse(readText(legacy)));
    renameSync(legacy, canonical);
    return false;
  }
  atomicWrite(
    canonical,
    JSON.stringify(
      { version: 1, libraryId: randomUUID(), current: null },
      null,
      2,
    ) + '\n',
  );
  return true;
}
