import type { ImportManifest, FlowReference } from '@flow-batch/protocol';
import { importTaskKey, referenceFiles } from './dispatch-plan.js';
import { saveReference } from './flow-assets.js';
import { readReferenceFile, validateReferenceFile } from './reference-file.js';

export async function preserveImportFiles(
  manifest: ImportManifest,
  batchId: string,
  files: readonly File[],
): Promise<{ references: FlowReference[]; taskKeys: string[] }> {
  const indexed = referenceFiles(files);
  // Validate the whole selection before preserving any take.
  const selected = manifest.tasks.map((take) => {
    const file = indexed.get(take.reference);
    if (!file)
      throw new Error(
        `Referência não encontrada: ${take.reference}. Selecione o arquivo ou a pasta raiz correta.`,
      );
    try {
      validateReferenceFile(file);
    } catch {
      throw new Error(
        `Referência inválida, vazia ou maior que 8 MB: ${take.reference}.`,
      );
    }
    return file;
  });
  const references: FlowReference[] = [],
    taskKeys: string[] = [];
  for (const [index, take] of manifest.tasks.entries()) {
    const taskKey = await importTaskKey(batchId, manifest.id, take.id);
    const file = selected[index]!;
    try {
      references.push(
        await saveReference({
          taskKey,
          reference: await readReferenceFile(file),
        }),
      );
    } catch {
      throw new Error(
        `Não foi possível preservar ${take.reference}. Confira a imagem e o armazenamento. IDs já importados exigem os materiais originais.`,
      );
    }
    taskKeys.push(taskKey);
  }
  return { references, taskKeys };
}
