import {
  preparationFormatSchema,
  type LibraryFiles,
} from '@flow-batch/protocol';
import {
  documentSections,
  documentText,
  type SectionLayout,
} from './document.js';
import { HttpError } from '../security/errors.js';

export const BASE_DOCUMENT = 'base.md';
const baseLayout: SectionLayout = {
  filename: BASE_DOCUMENT,
  marker: '<!-- flow-base:1 -->',
  labels: {
    common: 'Regras gerais',
    copy: 'Copy',
    image: 'Imagem',
    animation: 'Templates de animação',
  },
};
export const modulePaths = [
  BASE_DOCUMENT,
  ...preparationFormatSchema.options.map((format) => `formatos/${format}.md`),
];

export function isModular(files: LibraryFiles): boolean {
  return (
    BASE_DOCUMENT in files ||
    Object.keys(files).some((path) => path.startsWith('formatos/'))
  );
}
export function baseSections(text: string): Record<string, string> {
  return documentSections(text, baseLayout);
}
export function baseDocument(sections: Record<string, string> = {}): string {
  return documentText(sections, baseLayout);
}
export function emptyModules(): LibraryFiles {
  return Object.fromEntries(
    modulePaths.map((path) => [
      path,
      path === BASE_DOCUMENT ? baseDocument() : '',
    ]),
  );
}
export function validateModules(files: LibraryFiles): void {
  const unexpected = Object.keys(files).filter(
    (path) => !modulePaths.includes(path),
  );
  if (unexpected.length)
    throw new HttpError(
      409,
      `Não misture layouts ou arquivos desconhecidos na biblioteca modular: ${unexpected.join(', ')}.`,
    );
  if (files[BASE_DOCUMENT] === undefined)
    throw new HttpError(409, 'Biblioteca modular incompleta: falta base.md.');
  baseSections(files[BASE_DOCUMENT]);
}
export function modularRouting(files: LibraryFiles): {
  version: 2;
  common: string[];
  animation: string;
  formats: Record<string, string[]>;
} {
  validateModules(files);
  const sections = baseSections(files[BASE_DOCUMENT]!);
  return {
    version: 2,
    common: ['common', 'copy', 'image'].some((key) => sections[key]?.trim())
      ? [BASE_DOCUMENT]
      : [],
    animation: BASE_DOCUMENT,
    formats: Object.fromEntries(
      preparationFormatSchema.options.map((format) => {
        const path = `formatos/${format}.md`;
        return [format, files[path]?.trim() ? [path] : []];
      }),
    ),
  };
}
