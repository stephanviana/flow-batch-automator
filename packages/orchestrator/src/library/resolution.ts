import type { LibraryFiles } from '@flow-batch/protocol';
import { resolvedFiles as legacyFiles, LIBRARY_DOCUMENT } from './document.js';
import { BASE_DOCUMENT, isModular, validateModules } from './modular.js';

export function resolvedFiles(files: LibraryFiles): LibraryFiles {
  if (!isModular(files)) return legacyFiles(files);
  validateModules(files);
  return files;
}
export function defaultInstructionPath(files: LibraryFiles): string {
  if (isModular(files)) return BASE_DOCUMENT;
  return files[LIBRARY_DOCUMENT] === undefined
    ? 'instrucoes/rotas.json'
    : LIBRARY_DOCUMENT;
}
