import {
  preparationFormatSchema,
  libraryFilesSchema,
  type LibraryFiles,
} from '@flow-batch/protocol';
import { LIBRARY_DOCUMENT, documentSections } from './document.js';
import {
  BASE_DOCUMENT,
  baseDocument,
  isModular,
  validateModules,
} from './modular.js';
import { resolvedFiles } from './resolution.js';
import { animationText, routing, validateLibrary } from './routing.js';

export function splitFiles(files: LibraryFiles): LibraryFiles {
  resolvedFiles(files);
  if (isModular(files)) {
    validateModules(files);
    return files;
  }
  const config =
    files[LIBRARY_DOCUMENT] === undefined ? routing(files) : undefined;
  const combine = (paths: string[]): string =>
    [...new Set(paths)].map((path) => files[path] ?? '').join('\n\n');
  const sections = config
    ? {
        common: combine(config.common),
        animation: animationText(files),
        ...Object.fromEntries(
          preparationFormatSchema.options.map((format) => [
            format,
            combine(config.formats[format]),
          ]),
        ),
      }
    : documentSections(files[LIBRARY_DOCUMENT]!);
  return libraryFilesSchema.parse({
    [BASE_DOCUMENT]: baseDocument(sections),
    ...Object.fromEntries(
      preparationFormatSchema.options.map((format) => [
        `formatos/${format}.md`,
        sections[format] ?? '',
      ]),
    ),
  });
}
export interface SplitPreview {
  preview: true;
  draftHash: string;
  sources: string[];
  files: { path: string; bytes: number }[];
  configured: boolean;
  problem: string | null;
}
export function previewSplit(
  files: LibraryFiles,
  draftHash: string,
): SplitPreview {
  const divided = splitFiles(files);
  let problem: string | null = null;
  try {
    validateLibrary(divided);
  } catch (error) {
    problem = error instanceof Error ? error.message : 'Biblioteca incompleta.';
  }
  return {
    preview: true,
    draftHash,
    sources: Object.keys(files),
    files: Object.entries(divided).map(([path, text]) => ({
      path,
      bytes: Buffer.byteLength(text),
    })),
    configured: problem === null,
    problem,
  };
}
