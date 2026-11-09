import { type Preparation, usesSingleImage } from './preparations.js';
import type { ImportManifest } from './imports.js';
import { stableImportId } from './import-identity.js';

type Variation = Preparation['variations'][number];
type Stage = 'hook' | 'body' | 'cta';
const stages = [
  ['hook', '01-Gancho'],
  ['body', '02-Body'],
  ['cta', '03-CTA'],
] as const;

function animationRole(format: Variation['format'], stage: Stage): string {
  if (format === 'clone') return 'clone';
  if (format === 'full-pov' || (format === 'pov' && stage === 'hook'))
    return 'pov';
  if (stage === 'hook' && format === 'factory-inclined')
    return 'factory-inclined';
  if (stage === 'hook' && format.startsWith('factory')) return 'factory';
  return 'seller';
}

function renderAnimation(
  template: string,
  speech: string,
  direction: string,
  seconds: string,
): string {
  const replacements: Record<string, string> = {
    fala: speech,
    direcao: direction,
    duracao_segundos: seconds,
  };
  const prompt = template.replace(
    /\{\{(fala|direcao|duracao_segundos)\}\}/g,
    (_match, key: string) => replacements[key]!,
  );
  if (/\{\{|\[INSERIR/.test(prompt))
    throw new Error('O prompt contém um placeholder não resolvido.');
  return prompt;
}

export async function compileVariation(
  preparation: Preparation,
  variation: Variation,
  templates: Map<string, string>,
): Promise<ImportManifest['tasks']> {
  const ids = await Promise.all(
    stages.map(([stage]) =>
      stableImportId([
        'flow-preparation-v1',
        preparation.id,
        variation.id,
        stage,
      ]),
    ),
  );
  const singleImage = usesSingleImage(variation.format);
  const seconds = /^abra_i2v_(\d+)s/.exec(preparation.videoModel)?.[1] ?? '8';
  return stages.map(([stage, label], index) => {
    const sourceIndex =
      index === 0
        ? undefined
        : singleImage
          ? 0
          : stage === 'cta'
            ? 1
            : undefined;
    const role = animationRole(variation.format, stage);
    const template =
      templates.get(role) ??
      (role === 'factory-inclined' ? templates.get('factory') : undefined);
    if (!template)
      throw new Error(`Template de animação indisponível: ${role}.`);
    return {
      id: ids[index]!,
      product: preparation.product,
      video: `${variation.format} · ${variation.name}`,
      take: label,
      reference: preparation.reference,
      ...(sourceIndex === undefined
        ? {}
        : { reuseImageFrom: ids[sourceIndex]! }),
      output: { groupId: variation.id, filename: `${label}.mp4` },
      original: {
        imagePrompt: JSON.stringify(
          index === 0 || singleImage
            ? variation.hookImage
            : variation.presenterImage!,
        ),
        videoPrompt: renderAnimation(
          template,
          variation.copy[stage],
          variation.cloneVideo?.directions[stage] ?? '',
          seconds,
        ),
        copy: variation.copy[stage],
      },
      imageModel: preparation.imageModel,
      videoModel: preparation.videoModel,
      aspect: '9:16' as const,
    };
  });
}
