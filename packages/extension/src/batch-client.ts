import {
  batchActionReplySchema,
  type Batch,
  type BatchAction,
} from '@flow-batch/protocol';
import { z } from 'zod';
import { signedRequest } from './api.js';
import { createProject, openProject } from './flow-projects.js';
import { FlowInputError } from './flow-errors.js';

const receiptSchema = z.strictObject({
  clientId: z.uuid(),
  id: z.uuid(),
  attemptId: z.uuid(),
  projectId: z.uuid(),
  projectTitle: z.string().max(160).optional(),
});

async function action(
  clientId: string,
  input: BatchAction,
): Promise<z.infer<typeof batchActionReplySchema>> {
  return batchActionReplySchema.parse(
    await signedRequest(clientId, 'POST', '/api/batches', input),
  );
}

async function recoverReceipt(clientId: string, batch: Batch): Promise<Batch> {
  const key = `batch-receipt-${batch.id}`;
  const receipt = receiptSchema.safeParse(
    (await chrome.storage.local.get(key))[key],
  );
  if (!receipt.success || receipt.data.clientId !== clientId) return batch;
  if (batch.status === 'ready') {
    await chrome.storage.local.remove(key);
    return batch;
  }
  const reply = await action(clientId, {
    action: 'settle',
    id: batch.id,
    attemptId: receipt.data.attemptId,
    outcome: 'ready',
    projectId: receipt.data.projectId,
    ...(receipt.data.projectTitle
      ? { projectTitle: receipt.data.projectTitle }
      : {}),
  });
  await chrome.storage.local.remove(key);
  return reply.batch;
}

async function provision(clientId: string, batch: Batch): Promise<Batch> {
  batch = await recoverReceipt(clientId, batch);
  if (batch.status !== 'draft' || batch.mode !== 'new-project') return batch;
  const claim = await action(clientId, {
    action: 'claim',
    id: batch.id,
    expectedRevision: batch.revision,
  });
  if (!claim.attemptId) return claim.batch;
  const reply = await createProject(batch.name);
  const projectId = reply.ok ? z.uuid().safeParse(reply.value.projectId) : null;
  if (!reply.ok || !projectId?.success) {
    const outcome = !reply.ok && !reply.sent ? 'not-created' : 'uncertain';
    await action(clientId, {
      action: 'settle',
      id: batch.id,
      attemptId: claim.attemptId,
      outcome,
    });
    throw new FlowInputError(
      outcome === 'not-created'
        ? 'O projeto não foi criado. Confira o acesso ao Flow e solicite revisão do pedido pelo chat.'
        : 'Criação sem confirmação. Confira o Flow e vincule o projeto aberto; não será criado outro automaticamente.',
      {
        stage: 'project-creation',
        code: reply.ok ? 'invalid_project_id' : reply.code,
        sent: reply.ok || reply.sent,
      },
    );
  }
  const receipt = {
    clientId,
    id: batch.id,
    attemptId: claim.attemptId,
    projectId: projectId.data,
    ...(reply.value.projectTitle
      ? { projectTitle: reply.value.projectTitle }
      : {}),
  };
  await chrome.storage.local.set({ [`batch-receipt-${batch.id}`]: receipt });
  return recoverReceipt(clientId, batch);
}

export async function prepareDispatchBatch(
  clientId: string,
  draft: { id: string; name: string; mode: 'new-project' },
): Promise<Batch> {
  let batch = (await action(clientId, { action: 'prepare', draft })).batch;
  batch = await provision(clientId, batch);
  if (batch.status !== 'ready' || !batch.projectId)
    throw new FlowInputError(
      'Criação do projeto exige revisão. Nenhum outro projeto será criado automaticamente.',
    );
  await openProject(batch.projectId, false);
  await chrome.storage.local.set({
    activeBatchId: batch.id,
    dispatchFlow: {
      phase: 'ready',
      projectId: batch.projectId,
      message: `Projeto do lote ${batch.name} pronto.`,
      checkedAt: Date.now(),
    },
  });
  return batch;
}
