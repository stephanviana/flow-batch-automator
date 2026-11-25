import { createHash } from 'node:crypto';
import type { Page } from 'playwright-core';
import { flowIdSchema, type FlowExecute } from '@flow-batch/protocol';
import { findExistingImage, listProjectAssets } from '../media.js';
import { requireProject } from '../contracts.js';
import { AttemptReceipts } from './receipts.js';
import { applyGenerationSettings, imageModelName } from './settings.js';
import { ExecutionError } from './errors.js';
import { observeAction } from './response.js';
import { attachImage, waitForMedia } from './tiles.js';
import { exactPrompt } from './prompt.js';
import type { Checkpoint } from './take-events.js';

interface FrameContext {
  page: Page;
  command: FlowExecute;
  signal: AbortSignal;
  submitted: () => void;
  progress: (state: 'submitted' | 'generating') => void;
  checkpoint: (event: Checkpoint) => void;
}

export async function prepareFrame(
  home: string,
  page: Page,
  command: FlowExecute,
  signal: AbortSignal,
  submitted: () => void,
  progress: FrameContext['progress'],
  checkpoint: FrameContext['checkpoint'],
): Promise<string> {
  const context: FrameContext = {
    page,
    command,
    signal,
    submitted,
    progress,
    checkpoint,
  };
  if (command.sourceImage) return reuseFrame(context, command.sourceImage);
  const bytes = await validateReference(home, command);
  const referenceId = await uploadReference(context, bytes);
  progress('submitted');
  checkpoint({ stage: 'reference_uploaded', mediaId: referenceId });
  progress('generating');
  await waitForMedia(page, referenceId, 'image', signal);
  await attachImage(page, referenceId, false);
  return generateFrame(context);
}

async function reuseFrame(
  { page, command, progress, checkpoint }: FrameContext,
  source: NonNullable<FlowExecute['sourceImage']>,
): Promise<string> {
  const listing = await listProjectAssets(page, {
    projectId: command.flow.projectId,
    limit: 200,
    maxScrolls: 40,
  });
  const image = findExistingImage(listing, source.mediaId);
  progress('submitted');
  progress('generating');
  checkpoint({
    stage: 'image_reused',
    mediaId: image.mediaId,
    sourceTaskId: source.taskId,
  });
  return image.mediaId;
}

async function validateReference(
  home: string,
  command: FlowExecute,
): Promise<Uint8Array> {
  const bytes = await new AttemptReceipts(home).reference(
    command.flow.reference.assetId,
  );
  if (
    bytes.byteLength !== command.flow.reference.bytes ||
    createHash('sha256').update(bytes).digest('hex') !==
      command.flow.reference.sha256
  )
    throw new ExecutionError(
      'reference_changed',
      'A referência local difere do material autorizado.',
      true,
    );
  return bytes;
}

async function uploadReference(
  { page, command, signal, submitted }: FrameContext,
  bytes: Uint8Array,
): Promise<string> {
  const imageSettings = {
    kind: 'image' as const,
    model: imageModelName(command.flow.imageModel),
    aspect: command.flow.aspect,
  };
  if ((await applyGenerationSettings(page, imageSettings)) !== 0)
    throw new ExecutionError(
      'image_credit_quote_changed',
      'A imagem deixou de ter custo zero na interface. Confira o custo antes de autorizar a execução.',
      true,
    );
  await page
    .getByRole('button', { name: 'Add media menu', exact: true })
    .click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.getByRole('menuitem', { name: 'Upload', exact: true }).click(),
  ]);
  const extension = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  }[command.flow.reference.mime];
  const upload = await observeAction(
    page,
    { rpcId: 'maseQ', projectId: command.flow.projectId },
    async () => {
      signal.throwIfAborted();
      requireProject(page.url(), command.flow.projectId);
      submitted();
      await fileChooser.setFiles({
        name: `flow-${command.attemptId}.${extension}`,
        mimeType: command.flow.reference.mime,
        buffer: Buffer.from(bytes),
      });
    },
    signal,
  );
  return flowIdSchema.parse(upload.mediaId);
}

async function generateFrame({
  page,
  command,
  signal,
  submitted,
  checkpoint,
}: FrameContext): Promise<string> {
  await exactPrompt(page, command.original.imagePrompt);
  const image = await observeAction(
    page,
    { rpcId: 'ogiZ0b', projectId: command.flow.projectId },
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
  const mediaId = flowIdSchema.parse(image.mediaId);
  await waitForMedia(page, mediaId, 'image', signal);
  checkpoint({ stage: 'image_generated', mediaId });
  return mediaId;
}
