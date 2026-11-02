import {
  QUEUE_BODY_LIMIT,
  approvedImportSchema,
  taskInputSchema,
  type ApprovedImport,
  type Batch,
  type FlowReference,
  type ImportManifest,
  stableImportId,
} from '@flow-batch/protocol';
import { importOutput } from './dispatch-output.js';
export { stableImportId } from '@flow-batch/protocol';

export function referenceFiles(files: readonly File[]): Map<string, File> {
  const indexed = new Map<string, File>();
  for (const file of files) {
    const path = file.name;
    if (indexed.has(path))
      throw new Error(
        `Referência ambígua: ${path}. Selecione apenas um arquivo para esse caminho.`,
      );
    indexed.set(path, file);
  }
  return indexed;
}

async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function importTaskKey(
  batchId: string,
  manifestId: string,
  takeId: string,
): Promise<string> {
  return stableImportId(['flow-import-v1', batchId, manifestId, takeId]);
}

export function assertImportSize(plan: ApprovedImport): void {
  if (new TextEncoder().encode(JSON.stringify(plan)).length > QUEUE_BODY_LIMIT)
    throw new Error(
      'O lote excede 64 KiB de materiais. Divida o JSON em lotes menores com IDs distintos.',
    );
}

export function buildImportPlan(
  manifest: ImportManifest,
  batch: Batch,
  references: readonly FlowReference[],
  taskKeys: readonly string[],
): ApprovedImport {
  if (batch.status !== 'ready' || !batch.projectId)
    throw new Error('Prepare e abra o lote antes de importar.');
  const tasks = manifest.tasks.map((take, index) => {
    const taskKey = taskKeys[index];
    const reference = references[index];
    if (!taskKey || !reference) throw new Error('Referência ausente no lote.');
    return taskInputSchema.parse({
      taskKey,
      product: take.product,
      video: take.video,
      take: take.take,
      format: take.aspect,
      references: [],
      original: take.original,
      executor: 'google-flow',
      maxAttempts: 1,
      flow: {
        batchId: batch.id,
        projectId: batch.projectId,
        imageModel: take.imageModel,
        videoModel: take.videoModel,
        aspect: take.aspect,
        reference,
        ...(take.reuseImageFrom
          ? {
              imageSourceTaskKey:
                taskKeys[
                  manifest.tasks.findIndex(
                    (source) => source.id === take.reuseImageFrom,
                  )
                ],
            }
          : {}),
        ...(take.output ? { output: importOutput(batch, take) } : {}),
        seed: (parseInt(taskKey.slice(0, 8), 16) % 1_000_000_000) + 1,
        approval: {
          approvedAt: 1,
          imageGenerations: take.reuseImageFrom ? 0 : 1,
          videoGenerations: 1,
        },
      },
    });
  });
  const plan = approvedImportSchema.parse({ requestId: manifest.id, tasks });
  assertImportSize(plan);
  return plan;
}

export async function importFingerprint(plan: ApprovedImport): Promise<string> {
  return hash(JSON.stringify(plan));
}

export function approveImport(
  plan: ApprovedImport,
  approvedAt = Date.now(),
): ApprovedImport {
  const approved = approvedImportSchema.parse({
    requestId: crypto.randomUUID(),
    tasks: plan.tasks.map((task) =>
      task.executor === 'google-flow'
        ? {
            ...task,
            flow: {
              ...task.flow,
              approval: { ...task.flow.approval, approvedAt },
            },
          }
        : task,
    ),
  });
  assertImportSize(approved);
  return approved;
}
