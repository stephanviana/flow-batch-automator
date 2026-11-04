import { preparationSchema } from './preparations.js';
import {
  importManifestSchema,
  QUEUE_BODY_LIMIT,
  type ImportManifest,
} from './imports.js';
import { compileVariation } from './preparation-variation.js';

function readTemplates(markdown: string): Map<string, string> {
  const templates = new Map<string, string>();
  for (const [heading, name] of [
    ['Fábrica', 'factory'],
    ['Vendedora', 'seller'],
    ['POV', 'pov'],
    ['Clonagem', 'clone'],
  ] as const) {
    const section = markdown.split(`## ${heading} — `)[1]?.split('\n## ')[0];
    if (!section && name === 'clone') continue;
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
  const tasks = (
    await Promise.all(
      preparation.variations.map((variation) =>
        compileVariation(preparation, variation, templates),
      ),
    )
  ).flat();
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
