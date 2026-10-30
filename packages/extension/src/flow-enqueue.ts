import {
  flowDraftSchema,
  taskInputSchema,
  type FlowDraft,
} from '@flow-batch/protocol';
import { saveReference } from './flow-assets.js';
import { inspectFlow } from './flow.js';
import { signedRequest } from './api.js';
import { FlowInputError } from './flow-errors.js';

export async function enqueueFlow(
  clientId: string,
  input: FlowDraft,
): Promise<void> {
  const draft = flowDraftSchema.parse(input);
  const project = await inspectFlow();
  if (project.phase !== 'ready' || project.projectId !== draft.projectId)
    throw new FlowInputError(
      'Verifique novamente o projeto antes de autorizar o take.',
    );
  const reference = await saveReference(draft).catch((): never => {
    throw new FlowInputError(
      'Não foi possível preservar a referência. Use uma imagem JPEG, PNG ou WebP de até 8 MB e confira o armazenamento do Chrome.',
    );
  });
  const task = taskInputSchema.parse({
    taskKey: draft.taskKey,
    product: draft.product,
    video: draft.video,
    take: draft.take,
    format: draft.aspect,
    references: [],
    original: draft.original,
    executor: 'google-flow',
    maxAttempts: 1,
    flow: {
      projectId: draft.projectId,
      imageModel: draft.imageModel,
      videoModel: draft.videoModel,
      aspect: draft.aspect,
      seed: draft.seed,
      reference,
      approval: draft.approval,
    },
  });
  await signedRequest(clientId, 'POST', '/api/queue', {
    requestId: draft.requestId,
    tasks: [task],
  });
}
