import {
  FLOW_VIDEO_DIRECTORY,
  preparationFormatLabels,
  preparationFormatSchema,
  type Batch,
  type FlowOutput,
  type ImportManifest,
} from '@flow-batch/protocol';

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
