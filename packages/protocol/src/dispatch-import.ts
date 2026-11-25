import { taskInputSchema } from './queue.js';
import {
  QUEUE_BODY_LIMIT,
  approvedImportSchema,
  type ApprovedImport,
} from './imports.js';
import type { Batch } from './batches.js';
import type { FlowReference } from './flow.js';
import type { ImportManifest } from './imports.js';
import { stableImportId } from './import-identity.js';
import { FLOW_VIDEO_DIRECTORY, type FlowOutput } from './flow-output.js';
import {
  preparationFormatLabels,
  preparationFormatSchema,
} from './preparations.js';

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
  driver?: 'browser-ui',
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
        seed: driver
          ? null
          : (parseInt(taskKey.slice(0, 8), 16) % 1_000_000_000) + 1,
        ...(driver ? { driver, maxVideoCredits: 25 } : {}),
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

function slug(value: string, limit: number): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, limit)
      .replace(/-$/, '') || 'video'
  );
}
export function importOutput(
  batch: Batch,
  take: ImportManifest['tasks'][number],
): FlowOutput | undefined {
  if (!take.output) return undefined;
  const format = preparationFormatSchema.safeParse(
    take.video.split(' · ', 1)[0],
  );
  const formatName = format.success
    ? preparationFormatLabels[format.data]
    : take.video;
  const variation = `${batch.id.slice(0, 8)}-${take.output.groupId.replaceAll('-', '')}`;
  return {
    root: 'Flow',
    directory: `${FLOW_VIDEO_DIRECTORY}/${slug(take.product, 35)}--${slug(formatName, 26)}--${variation}`,
    filename: take.output.filename,
  };
}
