import { stripVTControlCharacters } from 'node:util';
import type { Page } from 'playwright-core';
import {
  flowExecuteSchema,
  type FlowExecute,
  type QueueCheckpoint,
} from '@flow-batch/protocol';
import type { ProfileBrowser } from '../browser.js';
import { FlowBrowserError } from '../contracts.js';
import { openExistingProject, requireIdleProject } from '../session.js';
import { AttemptReceipts } from './receipts.js';
import { ExecutionError } from './errors.js';

import { executeVideo } from './video-generation.js';
import { prepareFrame } from './image.js';
import type { Emit, Checkpoint } from './take-events.js';

export class BrowserTakeExecutor {
  private active = false;
  constructor(
    private readonly browser: ProfileBrowser,
    private readonly home: string,
  ) {}

  async run(
    input: FlowExecute,
    signal: AbortSignal,
    emit: Emit,
  ): Promise<void> {
    const command = flowExecuteSchema.parse(input);
    if (this.active)
      throw new ExecutionError(
        'executor_busy',
        'Já há uma tentativa ativa neste executor.',
        true,
      );
    this.active = true;
    let sent = false;
    const base = { taskId: command.taskId, attemptId: command.attemptId };
    const progress = (
      state: 'submitted' | 'generating' | 'download_pending',
    ): void =>
      emit({
        type: 'queue-progress',
        ...base,
        state,
        generationId: `flow-${command.attemptId}`,
      });
    const checkpoint = (event: Checkpoint): void =>
      emit({ type: 'queue-checkpoint', ...base, ...event } as QueueCheckpoint);
    let release: (() => Promise<void>) | undefined;
    try {
      if (command.flow.driver !== 'browser-ui' || command.flow.seed !== null)
        throw new ExecutionError(
          'flow_driver_mismatch',
          'O take não foi preparado para os parâmetros da interface do Flow.',
          true,
        );
      release = await this.browser.reserve();
      await new AttemptReceipts(this.home).record(command.attemptId);
      const page = await this.page(command, signal);
      const frame = await prepareFrame(
        this.home,
        page,
        command,
        signal,
        (): void => {
          sent = true;
        },
        progress,
        checkpoint,
      );
      const result = await executeVideo(
        page,
        this.home,
        command,
        frame,
        signal,
        (): void => {
          sent = true;
        },
        progress,
        checkpoint,
      );
      emit({
        type: 'queue-progress',
        ...base,
        state: 'completed',
        generationId: `flow-${command.attemptId}`,
        result,
      });
    } catch (error) {
      const known = error instanceof ExecutionError ? error : undefined;
      const browserError =
        !known && error instanceof FlowBrowserError ? error : undefined;
      const safe =
        !sent &&
        (known?.notSubmitted ??
          (browserError !== undefined &&
            browserError.code !== 'attempt_receipt_failed'));
      const sanitized =
        !known && !browserError && error instanceof Error
          ? stripVTControlCharacters(error.message)
              .split(/\r?\n/)
              .slice(0, 3)
              .join(' | ')
              .replace(/https?:\/\/\S+/gi, '[url]')
              .slice(0, 240)
          : '';
      if (!known && !browserError)
        console.error(
          `[flow-worker] ${command.taskId} failed (${sent ? 'after-send' : 'pre-send'}): ${sanitized || 'unknown error'}`,
        );
      emit({
        type: 'queue-progress',
        ...base,
        state: safe || known?.confirmedFailure ? 'failed' : 'uncertain',
        error: {
          code:
            known?.code ?? browserError?.code ?? 'browser_execution_unknown',
          message:
            known?.message ??
            browserError?.message ??
            (!sent && sanitized
              ? `Falha na interface do Flow antes do envio: ${sanitized}`
              : sanitized
                ? `Não foi possível confirmar esta tentativa (${sanitized}). Confira o projeto antes de repetir.`
                : 'Não foi possível confirmar esta tentativa. Confira o projeto antes de repetir.'),
          retryable: false,
          notSubmitted: safe,
        },
      });
    } finally {
      this.active = false;
      await release?.();
    }
  }

  private async page(command: FlowExecute, signal: AbortSignal): Promise<Page> {
    signal.throwIfAborted();
    const page = await this.browser.page();
    if (!page)
      throw new ExecutionError(
        'flow_tab_missing',
        'Abra o projeto no Chrome dedicado.',
        true,
      );
    await openExistingProject(page, command.flow.projectId);
    const language = await page.evaluate(() => document.documentElement.lang);
    if (command.attemptNumber > 1 || !/^en\b/i.test(language))
      await page.goto(
        `https://flow.google.com/project/${command.flow.projectId}?hl=en`,
        { waitUntil: 'domcontentloaded', timeout: 20000 },
      );
    await page
      .locator('.ProseMirror[contenteditable="true"]')
      .waitFor({ state: 'visible', timeout: 20000 });
    await requireIdleProject(page, command.flow.projectId);
    const agent = page.getByRole('button', { name: /^(Flow )?Agent$/ });
    if (
      (await agent.count()) === 1 &&
      (await agent.getAttribute('aria-pressed')) === 'true'
    )
      await agent.click();
    if (
      (
        await page
          .locator('.ProseMirror[contenteditable="true"]')
          .allTextContents()
      ).some((text) => text.trim())
    )
      throw new ExecutionError(
        'composer_not_empty',
        'Há um texto no compositor. Preserve-o antes de executar a fila.',
        true,
      );
    return page;
  }
}
