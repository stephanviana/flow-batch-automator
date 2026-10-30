import {
  batchActionReplySchema,
  batchListSchema,
  queueSnapshotSchema,
  type Batch,
  type BatchAction,
  type PopupRequest,
  type FlowInspection,
} from '@flow-batch/protocol';
import { z } from 'zod';
import { signedRequest } from './api.js';
import { inspectFlow } from './flow.js';
import { createProject, openProject } from './flow-projects.js';
import { FlowInputError } from './flow-errors.js';

const receiptSchema = z.strictObject({
  clientId: z.uuid(),
  id: z.uuid(),
  attemptId: z.uuid(),
  projectId: z.uuid(),
  projectTitle: z.string().max(160).optional(),
});

export async function batchSnapshot(
  clientId: string,
): Promise<{ batches: Batch[]; activeBatchId: string | null }> {
  const { batches } = batchListSchema.parse(
    await signedRequest(clientId, 'GET', '/api/batches'),
  );
  const stored = await chrome.storage.local.get('activeBatchId');
  return {
    batches,
    activeBatchId: batches.some((batch) => batch.id === stored.activeBatchId)
      ? String(stored.activeBatchId)
      : null,
  };
}

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
        ? 'O projeto não foi criado. Entre no Flow e clique em Abrir lote para tentar novamente.'
        : 'Criação sem confirmação. Confira o Flow e vincule o projeto aberto; não será criado outro automaticamente.',
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

async function attach(clientId: string, batch: Batch): Promise<Batch> {
  const project = await inspectFlow();
  if (
    project.phase !== 'ready' ||
    !z.uuid().safeParse(project.projectId).success
  )
    throw new FlowInputError(
      'Abra e verifique o projeto do Flow que deseja vincular ao lote.',
    );
  return (
    await action(clientId, {
      action: 'attach',
      id: batch.id,
      expectedRevision: batch.revision,
      projectId: project.projectId!,
    })
  ).batch;
}

export async function batchCommand(
  clientId: string,
  message: PopupRequest,
): Promise<FlowInspection | null> {
  const queue = queueSnapshotSchema.parse(
    await signedRequest(clientId, 'GET', '/api/queue'),
  );
  if (
    queue.tasks.some((task) =>
      ['dispatching', 'submitted', 'generating', 'download_pending'].includes(
        task.state,
      ),
    ) ||
    (queue.running && queue.counts.queued > 0)
  )
    throw new FlowInputError(
      'Pause a fila e aguarde o take atual terminar antes de trocar de lote.',
    );
  let batch: Batch;
  if (message.type === 'batch-prepare' && message.batchDraft)
    batch = (
      await action(clientId, { action: 'prepare', draft: message.batchDraft })
    ).batch;
  else {
    const snapshot = await batchSnapshot(clientId);
    const existing = snapshot.batches.find(
      (candidate) => candidate.id === message.batchId,
    );
    if (!existing) throw new FlowInputError('Selecione um lote registrado.');
    batch = existing;
    if (
      message.expectedRevision !== undefined &&
      message.expectedRevision !== batch.revision
    )
      throw new FlowInputError(
        'O lote mudou. Confira o estado atualizado antes de continuar.',
      );
  }
  await chrome.storage.local.set({ activeBatchId: batch.id });
  if (
    message.type === 'batch-attach' ||
    (batch.mode === 'existing-project' && batch.status === 'draft')
  )
    batch = await attach(clientId, batch);
  else batch = await provision(clientId, batch);
  if (batch.status !== 'ready' || !batch.projectId)
    throw new FlowInputError(
      'Confira os projetos no Flow. Abra o projeto correto e use “Vincular projeto aberto” para resolver a criação sem confirmação.',
    );
  await openProject(batch.projectId);
  return inspectFlow();
}
