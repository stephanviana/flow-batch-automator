import { z } from 'zod';
import {
  libraryFileSchema,
  preparationFormatSchema,
  readAnimationTemplates,
  type LibraryFiles,
  type PreparationFormat,
} from '@flow-batch/protocol';
import { HttpError } from '../security/errors.js';

const paths = z.array(libraryFileSchema).min(1).max(64);
const routingSchema = z.strictObject({
  common: paths,
  formats: z.record(preparationFormatSchema, paths),
});
export const initialRouting = {
  common: [
    'instrucoes/copy.md',
    'instrucoes/imagem.md',
    'instrucoes/imagem/produto-e-realismo.md',
    'instrucoes/imagem/roupas-e-uniformes.md',
    'instrucoes/imagem/redacao-e-revisao.md',
  ],
  formats: {
    factory: [
      'instrucoes/copy/fabrica.md',
      'instrucoes/imagem/fabrica-padrao.md',
    ],
    'factory-group': [
      'instrucoes/copy/fabrica.md',
      'instrucoes/imagem/fabrica-grupo.md',
    ],
    'factory-truck': [
      'instrucoes/copy/fabrica.md',
      'instrucoes/imagem/fabrica-caminhao.md',
    ],
    'factory-inclined': [
      'instrucoes/copy/fabrica.md',
      'instrucoes/imagem/fabrica-esteira.md',
    ],
    pov: ['instrucoes/copy/pov.md', 'instrucoes/imagem/pov-e-vendedora.md'],
    'full-pov': [
      'instrucoes/copy/pov.md',
      'instrucoes/imagem/pov-e-vendedora.md',
    ],
    seller: [
      'instrucoes/copy/vendedora.md',
      'instrucoes/imagem/pov-e-vendedora.md',
    ],
    clone: ['instrucoes/clonagem.md'],
  },
};
export function instructionPaths(
  files: LibraryFiles,
  formats: PreparationFormat[],
): string[] {
  let configuration: unknown;
  try {
    configuration = JSON.parse(
      files['instrucoes/rotas.json'] ?? '{}',
    ) as unknown;
  } catch {
    throw new HttpError(400, 'instrucoes/rotas.json contém JSON inválido.');
  }
  const routing = routingSchema.parse(configuration);
  const selected = [
    ...new Set([
      ...routing.common,
      ...formats.flatMap((format) => routing.formats[format]),
    ]),
  ];
  for (const path of selected)
    if (!files[path]?.trim())
      throw new HttpError(400, `Instrução ausente ou vazia: ${path}`);
  return selected;
}
export function validateLibrary(files: LibraryFiles): void {
  instructionPaths(files, preparationFormatSchema.options);
  try {
    readAnimationTemplates(files['instrucoes/animacao.md'] ?? '', true);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : 'Template de animação inválido.',
    );
  }
}
