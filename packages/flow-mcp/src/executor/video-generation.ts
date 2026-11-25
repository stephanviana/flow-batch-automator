import type { Page } from 'playwright-core';
import {
  flowIdSchema,
  flowResultSchema,
  type FlowExecute,
  type FlowResult,
} from '@flow-batch/protocol';
import { requireProject } from '../contracts.js';
import { applyGenerationSettings, videoSettings } from './settings.js';
import { ExecutionError } from './errors.js';
import { attachImage } from './tiles.js';
import { exactPrompt } from './prompt.js';
import { observeAction } from './response.js';
import { observeVideo } from './video.js';
import { downloadClip } from './download.js';
import type { Checkpoint } from './take-events.js';

export async function executeVideo(
  page: Page,
  home: string,
  command: FlowExecute,
  frame: string,
  signal: AbortSignal,
  submitted: () => void,
  progress: (state: 'download_pending') => void,
  checkpoint: (event: Checkpoint) => void,
): Promise<FlowResult> {
  const quote = await applyGenerationSettings(
    page,
    videoSettings(command.flow),
  );
  if (quote > (command.flow.maxVideoCredits ?? 0))
    throw new ExecutionError(
      'flow_credit_quote_exceeded',
      'O custo mostrado excedeu o limite registrado para este take. Nenhum vídeo foi enviado.',
      true,
    );
  await attachImage(page, frame, true);
  await exactPrompt(page, command.original.videoPrompt);
  const { operationId, video } = await observeVideo(
    page,
    command.flow.projectId,
    signal,
    async () => {
      const accepted = await observeAction(
        page,
        { rpcId: 'eb1hJf', projectId: command.flow.projectId },
        async () => {
          signal.throwIfAborted();
          requireProject(page.url(), command.flow.projectId);
          submitted();
          await page
            .getByRole('button', { name: 'Start generation', exact: true })
            .click({ timeout: 10000 });
        },
        signal,
      );
      const id = flowIdSchema.parse(accepted.operationId);
      checkpoint({ stage: 'video_submitted', operationId: id });
      return id;
    },
  );
  checkpoint({ stage: 'video_ready', mediaId: video.mediaId });
  progress('download_pending');
  const download = await downloadClip(
    page,
    home,
    command,
    video.url,
    signal,
    (downloadId) => checkpoint({ stage: 'download_started', downloadId }),
  );

  return flowResultSchema.parse({
    simulated: false,
    ...download,
    imageMediaId: frame,
    videoMediaId: video.mediaId,
    operationId,
    description:
      'Vídeo gerado pela interface do Flow e download confirmado pelo Chrome.',
  });
}
