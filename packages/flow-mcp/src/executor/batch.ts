import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  batchActionReplySchema,
  type Batch,
  type BatchAction,
} from '@flow-batch/protocol';
import { z } from 'zod';
import type { ProfileBrowser } from '../browser.js';
import { inspectSession, openExistingProject } from '../session.js';
import { projectFromUrl } from '../contracts.js';
import type { ExecutorApi } from './api.js';
import { ExecutionError } from './errors.js';

const receiptSchema = z.strictObject({
  clientId: z.uuid(),
  attemptId: z.uuid(),
  projectId: z.uuid(),
  projectTitle: z.string().max(160),
});
async function action(
  api: ExecutorApi,
  input: BatchAction,
): Promise<z.infer<typeof batchActionReplySchema>> {
  return batchActionReplySchema.parse(
    await api.call('POST', '/api/batches', input),
  );
}

export async function prepareBrowserBatch(
  api: ExecutorApi,
  browser: ProfileBrowser,
  home: string,
  id: string,
  name: string,
  signal: AbortSignal,
): Promise<Batch> {
  const release = await browser.reserve();
  try {
    return await prepareReservedBatch(api, browser, home, id, name, signal);
  } finally {
    await release();
  }
}

async function prepareReservedBatch(
  api: ExecutorApi,
  browser: ProfileBrowser,
  home: string,
  id: string,
  name: string,
  signal: AbortSignal,
): Promise<Batch> {
  let batch = (
    await action(api, {
      action: 'prepare',
      draft: { id, name, mode: 'new-project' },
    })
  ).batch;
  const receiptPath = join(home, `project-${id}.json`);
  let receipt: z.infer<typeof receiptSchema> | undefined;
  try {
    receipt = receiptSchema.parse(
      JSON.parse(await readFile(receiptPath, 'utf8')),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new ExecutionError(
        'project_receipt_invalid',
        'O recibo do projeto não pôde ser confirmado. Solicite revisão.',
        true,
      );
  }
  if (receipt && receipt.clientId !== api.clientId)
    throw new ExecutionError(
      'project_owner_changed',
      'O projeto pertence a outra identidade local.',
      true,
    );
  if (receipt && batch.status !== 'ready')
    batch = (
      await action(api, {
        action: 'settle',
        id,
        attemptId: receipt.attemptId,
        projectId: receipt.projectId,
        projectTitle: receipt.projectTitle,
        outcome: 'ready',
      })
    ).batch;
  const page = await browser.page();
  if (!page)
    throw new ExecutionError(
      'flow_tab_missing',
      'Abra o Flow no Chrome dedicado antes de processar o pedido.',
      true,
    );
  if (batch.status === 'ready' && batch.projectId) {
    await openExistingProject(page, batch.projectId);
    return batch;
  }
  if (batch.status !== 'draft')
    throw new ExecutionError(
      'project_review_required',
      'A criação anterior exige revisão. Nenhum outro projeto será criado automaticamente.',
      false,
    );
  const status = await inspectSession(page);
  if (status.phase === 'busy' || status.phase === 'login-required')
    throw new ExecutionError('project_not_ready', status.message, true);
  if (
    (
      await page
        .locator('.ProseMirror[contenteditable="true"]')
        .allTextContents()
    ).some((text) => text.trim())
  )
    throw new ExecutionError(
      'composer_not_empty',
      'Há um texto no compositor; preserve-o antes de processar o pedido.',
      true,
    );
  const claim = await action(api, {
    action: 'claim',
    id,
    expectedRevision: batch.revision,
  });
  if (!claim.attemptId)
    throw new ExecutionError(
      'project_claim_failed',
      'Não foi possível reservar a criação do projeto.',
      true,
    );
  let sent = false;
  try {
    signal.throwIfAborted();
    if (new URL(page.url()).pathname !== '/')
      await page.goto('https://flow.google.com/?hl=en', {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
    const create = page.getByRole('button', { name: /new project/i });
    await create.waitFor({ state: 'visible', timeout: 15000 });
    signal.throwIfAborted();
    sent = true;
    await create.click({ timeout: 10000 });
    await page.waitForURL((url) => Boolean(projectFromUrl(url.href)), {
      timeout: 30000,
    });
    const projectId = z.uuid().parse(projectFromUrl(page.url()));
    // Preserve the confirmed identity before any optional naming interaction.
    const confirmed = {
      clientId: api.clientId,
      attemptId: claim.attemptId,
      projectId,
      projectTitle: name,
    };
    await writeFile(receiptPath, JSON.stringify(confirmed), {
      flag: 'wx',
      mode: 0o600,
    });
    const title = page.getByRole('textbox', {
      name: 'Editable text',
      exact: true,
    });
    if ((await title.count()) === 1) {
      await title.fill(name);
      await title.press('Enter');
    }
    return (
      await action(api, {
        action: 'settle',
        id,
        attemptId: claim.attemptId,
        projectId,
        projectTitle: name,
        outcome: 'ready',
      })
    ).batch;
  } catch {
    await action(api, {
      action: 'settle',
      id,
      attemptId: claim.attemptId,
      outcome: sent ? 'uncertain' : 'not-created',
    }).catch(() => {});
    throw new ExecutionError(
      sent ? 'project_creation_unknown' : 'project_creation_not_sent',
      sent
        ? 'A criação foi enviada, mas a conclusão não foi confirmada. Revise o projeto antes de repetir.'
        : 'A criação não chegou a ser enviada. Confira a janela do Flow e solicite revisão.',
      !sent,
    );
  }
}
