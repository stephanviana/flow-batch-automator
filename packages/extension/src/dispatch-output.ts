import type { Batch, FlowOutput, ImportManifest } from '@flow-batch/protocol';

function slug(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30)
      .replace(/-$/, '') || 'video'
  );
}
export function importOutput(
  batch: Batch,
  take: ImportManifest['tasks'][number],
): FlowOutput | undefined {
  if (!take.output) return undefined;
  return {
    directory: `${slug(batch.name)}-${batch.id}/${slug(take.video)}-${take.output.groupId}`,
    filename: take.output.filename,
  };
}
