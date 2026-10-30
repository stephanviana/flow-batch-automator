import {
  batchDraftSchema,
  type PopupRequest,
  type popupReplySchema,
  type Batch,
} from '@flow-batch/protocol';
import type { z } from 'zod';
import { setBatchChanging } from './flow-form.js';

type Reply = z.infer<typeof popupReplySchema>;
type Send = (request: PopupRequest) => Promise<Reply>;
const select = document.querySelector<HTMLSelectElement>('#batch-select')!;
const details = document.querySelector<HTMLDetailsElement>('#batch-new')!;
const form = document.querySelector<HTMLFormElement>('#batch-form')!;
const prepare = document.querySelector<HTMLButtonElement>('#batch-prepare')!;
const open = document.querySelector<HTMLButtonElement>('#batch-open')!;
const attach = document.querySelector<HTMLButtonElement>('#batch-attach')!;
const reviewed = document.querySelector<HTMLInputElement>('#batch-reviewed')!;
const review = document.querySelector<HTMLDivElement>('#batch-review')!;
const status = document.querySelector<HTMLParagraphElement>('#batch-status')!;
const feedback =
  document.querySelector<HTMLParagraphElement>('#batch-feedback')!;
let latest: Reply | undefined;
let busy = false;
let selectedDirty = false;
let stamp = '';
let pending: z.infer<typeof batchDraftSchema> | undefined;
const labels = {
  draft: 'aguardando preparação',
  creating: 'criação pendente de confirmação',
  ready: 'projeto vinculado',
  uncertain: 'criação exige revisão',
};

function selectedBatch(): Batch | undefined {
  return latest?.batches.find((batch) => batch.id === select.value);
}
function updateControls(): void {
  const connected =
    latest?.state.phase === 'connected' && latest.queue !== null;
  const batch = selectedBatch();
  const processing =
    latest?.queue &&
    ((latest.queue.running && latest.queue.counts.queued > 0) ||
      latest.queue.tasks.some((task) =>
        ['dispatching', 'submitted', 'generating', 'download_pending'].includes(
          task.state,
        ),
      ));
  select.disabled = busy || !connected;
  prepare.disabled = busy || !connected || Boolean(processing);
  open.disabled = busy || !connected || !batch || Boolean(processing);
  review.hidden = !batch || !['creating', 'uncertain'].includes(batch.status);
  attach.disabled =
    busy ||
    !connected ||
    !reviewed.checked ||
    review.hidden ||
    Boolean(processing);
  setBatchChanging(busy || details.open || selectedDirty);
}

export function renderBatchForm(reply: Reply): void {
  latest = reply;
  const nextStamp = JSON.stringify(reply.batches);
  if (stamp !== nextStamp) {
    const selection = select.value;
    select.replaceChildren(new Option('Selecione um lote', ''));
    for (const batch of reply.batches)
      select.add(
        new Option(`${batch.name} · ${labels[batch.status]}`, batch.id),
      );
    select.value = selection;
    stamp = nextStamp;
  }
  if (!selectedDirty) select.value = reply.activeBatchId ?? '';
  const active = reply.batches.find(
    (batch) => batch.id === reply.activeBatchId,
  );
  status.textContent = active
    ? `Lote aberto: ${active.name} · ${labels[active.status]}${active.projectId ? ` · Projeto: ${active.projectId}` : ''}`
    : 'Prepare um novo lote ou abra um lote registrado antes de adicionar takes.';
  updateControls();
}

async function perform(send: Send, request: PopupRequest): Promise<void> {
  if (busy) return;
  busy = true;
  updateControls();
  feedback.textContent =
    request.type === 'batch-prepare'
      ? 'Preparando lote e projeto…'
      : 'Abrindo o projeto do lote…';
  try {
    const reply = await send(request);
    feedback.textContent =
      reply.operationError ??
      'Lote pronto. Os próximos takes usarão este projeto.';
    if (!reply.operationError) {
      pending = undefined;
      selectedDirty = false;
      reviewed.checked = false;
      details.open = false;
      if (request.type === 'batch-prepare') form.reset();
    }
    renderBatchForm(reply);
  } catch {
    feedback.textContent =
      'Não foi possível confirmar. Abra o mesmo lote novamente para consultar seu estado; confira o Flow antes de criar outro.';
  } finally {
    busy = false;
    updateControls();
  }
}

export function initializeBatchForm(send: Send): void {
  details.addEventListener('toggle', updateControls);
  reviewed.addEventListener('change', updateControls);
  select.addEventListener('change', (): void => {
    selectedDirty = select.value !== latest?.activeBatchId;
    reviewed.checked = false;
    updateControls();
  });
  form.addEventListener('input', (): void => {
    pending = undefined;
  });
  form.addEventListener('submit', (event): void => {
    event.preventDefault();
    if (prepare.disabled) return;
    const fields = new FormData(form);
    const draft = batchDraftSchema.safeParse(
      pending ?? {
        id: crypto.randomUUID(),
        name: fields.get('batchName'),
        mode: fields.get('batchMode'),
      },
    );
    if (!draft.success) {
      feedback.textContent =
        'Informe um nome para o lote, com até 120 caracteres.';
      return;
    }
    pending = draft.data;
    void perform(send, { type: 'batch-prepare', batchDraft: pending });
  });
  open.addEventListener('click', (): void => {
    if (!open.disabled)
      void perform(send, { type: 'batch-open', batchId: select.value });
  });
  attach.addEventListener('click', (): void => {
    const batch = selectedBatch();
    if (!attach.disabled && batch)
      void perform(send, {
        type: 'batch-attach',
        batchId: batch.id,
        expectedRevision: batch.revision,
      });
  });
}
