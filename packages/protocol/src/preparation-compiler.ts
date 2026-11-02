import { preparationSchema } from './preparations.js';
import {
  importManifestSchema,
  QUEUE_BODY_LIMIT,
  type ImportManifest,
} from './imports.js';
import { stableImportId } from './import-identity.js';

function readTemplates(markdown: string): Map<string, string> {
  const templates = new Map<string, string>();
  for (const [heading, name] of [
    ['Fábrica', 'factory'],
    ['Vendedora', 'seller'],
    ['POV', 'pov'],
  ] as const) {
    const section = markdown.split(`## ${heading} — `)[1]?.split('\n## ')[0];
    const template = section?.match(/```text\n([\s\S]*?)\n```/)?.[1];
    if (
      !template?.includes('{{fala}}') ||
      !template.trim().split('\n').at(-1)?.startsWith('Visual exclusions:')
    )
      throw new Error(`Template de animação incompleto: ${heading}.`);
    templates.set(name, template);
  }
  return templates;
}

export async function compilePreparation(
  input: unknown,
  markdown: string,
): Promise<ImportManifest> {
  const preparation = preparationSchema.parse(input);
  const templates = readTemplates(markdown);
  const seconds = /^abra_i2v_(\d+)s/.exec(preparation.videoModel)?.[1] ?? '8';
  const tasks = [];
  for (const variation of preparation.variations) {
    const bodyId = await stableImportId([
      'flow-preparation-v1',
      preparation.id,
      variation.id,
      'body',
    ]);
    for (const [stage, label] of [
      ['hook', '01-Gancho'],
      ['body', '02-Body'],
      ['cta', '03-CTA'],
    ] as const) {
      const role =
        stage !== 'hook'
          ? 'seller'
          : variation.format.startsWith('factory')
            ? 'factory'
            : variation.format;
      const template = templates.get(role)!;
      const speech = variation.copy[stage];
      const videoPrompt = template
        .replaceAll('{{duracao_segundos}}', seconds)
        .replaceAll('{{fala}}', speech);
      if (/\{\{|\[INSERIR/.test(videoPrompt))
        throw new Error('O prompt contém um placeholder não resolvido.');
      tasks.push({
        id: await stableImportId([
          'flow-preparation-v1',
          preparation.id,
          variation.id,
          stage,
        ]),
        product: preparation.product,
        video: `${variation.format} · ${variation.name}`,
        take: label,
        reference: preparation.reference,
        ...(stage === 'cta' ? { reuseImageFrom: bodyId } : {}),
        output: { groupId: variation.id, filename: `${label}.mp4` },
        original: {
          imagePrompt: JSON.stringify(
            stage === 'hook' ? variation.hookImage : variation.presenterImage,
          ),
          videoPrompt,
          copy: speech,
        },
        imageModel: preparation.imageModel,
        videoModel: preparation.videoModel,
        aspect: '9:16',
      });
    }
  }
  const manifest = importManifestSchema.parse({
    version: 1,
    id: preparation.id,
    tasks,
  });
  // Reserve room for reference metadata, queue IDs and approval. The panel checks the exact request.
  if (
    new TextEncoder().encode(JSON.stringify(manifest)).length +
      tasks.length * 1024 >
    QUEUE_BODY_LIMIT
  )
    throw new Error(
      'Preparação excede o limite da fila. Divida em preparações menores com IDs próprios.',
    );
  return manifest;
}
