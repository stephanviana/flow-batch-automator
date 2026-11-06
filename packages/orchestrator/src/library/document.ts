import {
  preparationFormatSchema,
  type LibraryFiles,
} from '@flow-batch/protocol';
import { HttpError } from '../security/errors.js';

export const LIBRARY_DOCUMENT = 'biblioteca.md';
const marker = '<!-- flow-biblioteca:1 -->';
const labels: Record<string, string> = {
  common: 'Regras gerais',
  copy: 'Copy',
  image: 'Imagem',
  ...Object.fromEntries(
    preparationFormatSchema.options.map((format) => [
      format,
      `Formato ${format}`,
    ]),
  ),
  animation: 'Templates de animação',
};
export function documentText(sections: Record<string, string> = {}): string {
  return (
    marker +
    '\n\n' +
    Object.entries(labels)
      .map(([key, label]) => `# [${key}] ${label}\n\n${sections[key] ?? ''}`)
      .join('\n\n') +
    '\n'
  );
}
export function documentSections(text: string): Record<string, string> {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!text.startsWith(marker + '\n'))
    throw new HttpError(
      400,
      'biblioteca.md exige o marcador <!-- flow-biblioteca:1 -->.',
    );
  const sections: Record<string, string> = {};
  let active: string | undefined,
    fence = '',
    body: string[] = [];
  const finish = (): void => {
    if (active)
      sections[active] = body
        .join('\n')
        .replace(/^(?:[ \t]*\n)+/, '')
        .replace(/(?:\n[ \t]*)+$/, '');
  };
  for (const line of text.slice(marker.length + 1).split('\n')) {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (delimiter) {
      if (!fence) fence = delimiter[1]!;
      else if (
        delimiter[1]![0] === fence[0] &&
        delimiter[1]!.length >= fence.length &&
        !delimiter[2]!.trim()
      )
        fence = '';
    }
    const heading = !fence && line.match(/^# \[([^\]]+)\](?:\s.*)?$/);
    if (heading) {
      finish();
      const key = heading[1]!;
      if (
        !Object.hasOwn(labels, key) ||
        Object.hasOwn(sections, key) ||
        key === active
      )
        throw new HttpError(
          400,
          `Seção inválida ou repetida em biblioteca.md: ${key}.`,
        );
      active = key;
      body = [];
    } else if (active) body.push(line);
    else if (line.trim())
      throw new HttpError(
        400,
        'Coloque as instruções dentro das seções de biblioteca.md.',
      );
  }
  if (fence)
    throw new HttpError(400, 'Feche o bloco de código em biblioteca.md.');
  finish();
  return sections;
}
export function documentFiles(text: string): LibraryFiles {
  const sections = documentSections(text),
    files: LibraryFiles = {};
  for (const [key, contents] of Object.entries(sections))
    if (contents.trim()) files[`instrucoes/${key}.md`] = contents;
  files['instrucoes/rotas.json'] = JSON.stringify({
    version: 2,
    animation: 'instrucoes/animation.md',
    common: ['common', 'copy', 'image']
      .filter((key) => sections[key]?.trim())
      .map((key) => `instrucoes/${key}.md`),
    formats: Object.fromEntries(
      preparationFormatSchema.options.map((format) => [
        format,
        sections[format]?.trim() ? [`instrucoes/${format}.md`] : [],
      ]),
    ),
  });
  return files;
}
export function resolvedFiles(files: LibraryFiles): LibraryFiles {
  if (files[LIBRARY_DOCUMENT] === undefined) return files;
  if (Object.keys(files).length !== 1)
    throw new HttpError(
      409,
      'Use biblioteca.md ou os arquivos separados; converta a biblioteca antes de misturar os formatos.',
    );
  return documentFiles(files[LIBRARY_DOCUMENT]);
}
