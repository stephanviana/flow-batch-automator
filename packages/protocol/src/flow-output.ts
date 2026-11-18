import { z } from 'zod';

const segment = '[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}';
const variationSegment = '[a-zA-Z0-9][a-zA-Z0-9_-]{0,109}';
export const FLOW_VIDEO_DIRECTORY = 'Videos';
const legacyDirectory = `${segment}(?:/${segment})?`;
const variationDirectory = `${FLOW_VIDEO_DIRECTORY}/${variationSegment}`;
const conflictSuffix = ' \\([1-9][0-9]{0,9}\\)';
const downloadConflict = new RegExp(`${conflictSuffix}(?=\\.mp4$)`);
const legacyFile = new RegExp(
  `^FlowBatch/${legacyDirectory}/${segment}\\.mp4$`,
);
const variationFile = new RegExp(
  `^Flow/${variationDirectory}/${segment}(?:${conflictSuffix})?\\.mp4$`,
);
const legacyDirectoryPattern = new RegExp(`^${legacyDirectory}$`);
const variationDirectoryPattern = new RegExp(`^${variationDirectory}$`);
const safeName = (value: string): boolean =>
  value === value.trim() &&
  value
    .split('/')
    .every(
      (part) => !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    );
export const flowFilenameSchema = z
  .string()
  .max(84)
  .regex(new RegExp(`^${segment}\\.mp4$`))
  .refine(safeName);
export const flowOutputSchema = z
  .strictObject({
    directory: z.string().max(161).refine(safeName),
    filename: flowFilenameSchema,
    root: z.literal('Flow').optional(),
  })
  .refine(
    ({ directory, root }) =>
      (root === 'Flow'
        ? variationDirectoryPattern
        : legacyDirectoryPattern
      ).test(directory),
    { path: ['directory'], message: 'Invalid Flow output directory' },
  );
export type FlowOutput = z.infer<typeof flowOutputSchema>;
export const flowOutputFileSchema = z
  .string()
  .max(256)
  .refine((path) => legacyFile.test(path) || variationFile.test(path))
  .refine((path) => safeName(path.replace(downloadConflict, '')));

export function flowOutputPath(taskId: string, output?: FlowOutput): string {
  return output
    ? `${output.root ?? 'FlowBatch'}/${output.directory}/${output.filename}`
    : `FlowBatch/${taskId}/take.mp4`;
}

export function matchesFlowOutputPath(
  taskId: string,
  output: FlowOutput | undefined,
  actual: string,
): boolean {
  const requested = flowOutputPath(taskId, output);
  if (actual === requested) return true;
  return Boolean(
    output?.root === 'Flow' &&
    variationFile.test(actual) &&
    actual.replace(downloadConflict, '') === requested,
  );
}
