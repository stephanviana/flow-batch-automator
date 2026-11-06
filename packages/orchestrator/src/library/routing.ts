import { z } from 'zod';
import {
  instructionFileSchema,
  preparationFormatSchema,
  readAnimationTemplates,
  type LibraryFiles,
  type PreparationFormat,
} from '@flow-batch/protocol';
import { HttpError } from '../security/errors.js';
import { documentText, LIBRARY_DOCUMENT, resolvedFiles } from './document.js';

const paths = z.array(instructionFileSchema).max(64);
const routingSchema = z.strictObject({
  version: z.literal(2).optional(),
  animation: instructionFileSchema.default('instrucoes/animacao.md'),
  common: paths,
  formats: z.record(preparationFormatSchema, paths),
});
export function emptyRouting(): z.infer<typeof routingSchema> {
  return routingSchema.parse({
    version: 2,
    animation: 'instrucoes/animacao.md',
    common: [],
    formats: Object.fromEntries(
      preparationFormatSchema.options.map((format) => [format, []]),
    ),
  });
}
export function routing(files: LibraryFiles): z.infer<typeof routingSchema> {
  files = resolvedFiles(files);
  if (!files['instrucoes/rotas.json'])
    throw new HttpError(
      409,
      'Pacote de instruções incompleto: falta instrucoes/rotas.json. Importe seu pacote antes de preparar pedidos.',
    );
  let configuration: unknown;
  try {
    configuration = JSON.parse(files['instrucoes/rotas.json']) as unknown;
  } catch {
    throw new HttpError(400, 'instrucoes/rotas.json contém JSON inválido.');
  }
  return routingSchema.parse(configuration);
}
export function instructionPaths(
  files: LibraryFiles,
  formats: PreparationFormat[],
): string[] {
  const document = files[LIBRARY_DOCUMENT] !== undefined;
  files = resolvedFiles(files);
  const config = routing(files);
  const missingBases = formats.filter(
    (format) => !config.formats[format].length,
  );
  if (!config.common.length || missingBases.length)
    throw new HttpError(
      409,
      document
        ? `Pacote de instruções incompleto: preencha as regras gerais, copy ou imagem e as seções ${missingBases.map((format) => `[${format}]`).join(', ') || 'dos formatos'} em biblioteca.md.`
        : `Pacote de instruções incompleto: configure as regras comuns e as bases de ${missingBases.join(', ') || 'cada formato'} em instrucoes/rotas.json.`,
    );
  const selected = [
    ...new Set([
      ...config.common,
      ...formats.flatMap((format) => config.formats[format]),
    ]),
  ];
  const missing = selected.filter((path) => !files[path]?.trim());
  if (missing.length)
    throw new HttpError(
      409,
      `Instruções ausentes ou vazias: ${missing.join(', ')}.`,
    );
  return selected;
}
export function animationText(files: LibraryFiles): string {
  files = resolvedFiles(files);
  const path = routing(files).animation;
  if (!files[path]?.trim())
    throw new HttpError(409, `Pacote de instruções incompleto: falta ${path}.`);
  return files[path];
}
export function consolidatedDocument(files: LibraryFiles): string {
  validateLibrary(files);
  if (files[LIBRARY_DOCUMENT] !== undefined) return files[LIBRARY_DOCUMENT];
  const config = routing(files);
  const combine = (paths: string[]): string =>
    [...new Set(paths)].map((path) => files[path] ?? '').join('\n\n');
  const text = documentText({
    common: combine(config.common),
    ...Object.fromEntries(
      preparationFormatSchema.options.map((format) => [
        format,
        combine(config.formats[format]),
      ]),
    ),
    animation: animationText(files),
  });
  validateLibrary({ [LIBRARY_DOCUMENT]: text });
  return text;
}
export function validateLibrary(
  files: LibraryFiles,
  formats = preparationFormatSchema.options,
): void {
  instructionPaths(files, formats);
  try {
    readAnimationTemplates(
      animationText(files),
      true,
      routing(files).version === 2,
    );
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'Template de animação inválido.',
    );
  }
}
