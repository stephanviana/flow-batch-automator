import { z } from 'zod';

const segment = '[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}';
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
export const flowOutputSchema = z.strictObject({
  directory: z
    .string()
    .max(161)
    .regex(new RegExp(`^${segment}(?:/${segment})?$`))
    .refine(safeName),
  filename: flowFilenameSchema,
});
export type FlowOutput = z.infer<typeof flowOutputSchema>;
export const flowOutputFileSchema = z
  .string()
  .max(256)
  .regex(new RegExp(`^FlowBatch/${segment}(?:/${segment})?/${segment}\\.mp4$`))
  .refine((path) => safeName(path.slice('FlowBatch/'.length)));

export function flowOutputPath(taskId: string, output?: FlowOutput): string {
  return output
    ? `FlowBatch/${output.directory}/${output.filename}`
    : `FlowBatch/${taskId}/take.mp4`;
}
