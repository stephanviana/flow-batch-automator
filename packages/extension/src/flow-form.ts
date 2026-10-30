import {
  flowDraftSchema,
  type FlowDraft,
  type PopupRequest,
  type popupReplySchema,
  resolveOmniVideoModel,
} from '@flow-batch/protocol';
import type { z } from 'zod';

type PanelReply = z.infer<typeof popupReplySchema>;
type Send = (message: PopupRequest) => Promise<PanelReply>;
const form = document.querySelector<HTMLFormElement>('#flow-form');
const feedback = document.querySelector<HTMLParagraphElement>('#flow-feedback');
const submit = document.querySelector<HTMLButtonElement>('#flow-submit');
const approval = document.querySelector<HTMLInputElement>('#flow-approval');
const videoModel = document.querySelector<HTMLSelectElement>(
  '[name="videoModel"]',
);
const omniOptions = document.querySelector<HTMLDivElement>('#omni-options');
let projectId: string | null = null;
let batchId: string | null = null;
let batchChanging = false;
let connected = false;
let busy = false;
let pending: FlowDraft | undefined;

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void =>
      typeof reader.result === 'string'
        ? resolve(reader.result.split(',')[1] ?? '')
        : reject(new Error('Não foi possível ler a referência.'));
    reader.onerror = (): void =>
      reject(new Error('Não foi possível ler a referência.'));
    reader.readAsDataURL(file);
  });
}
async function draft(): Promise<FlowDraft> {
  if (!form || !projectId || !batchId)
    throw new Error('Prepare e abra o lote antes de autorizar o take.');
  const fields = new FormData(form);
  const reference = fields.get('reference');
  if (
    !(reference instanceof File) ||
    !reference.size ||
    reference.size > 8_388_608
  )
    throw new Error('Selecione uma imagem de referência de até 8 MB.');
  return flowDraftSchema.parse({
    projectId,
    batchId,
    requestId: crypto.randomUUID(),
    taskKey: crypto.randomUUID(),
    product: fields.get('product'),
    video: fields.get('video'),
    take: fields.get('take'),
    original: {
      imagePrompt: fields.get('imagePrompt'),
      videoPrompt: fields.get('videoPrompt'),
      copy: fields.get('copy'),
    },
    imageModel: fields.get('imageModel'),
    videoModel:
      fields.get('videoModel') === 'omni_flash'
        ? resolveOmniVideoModel(
            Number(fields.get('videoDuration')),
            fields.get('videoResolution'),
          )
        : fields.get('videoModel'),
    aspect: fields.get('aspect'),
    seed: (crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000_000) + 1,
    approval: {
      approvedAt: Date.now(),
      imageGenerations: 1,
      videoGenerations: 1,
    },
    reference: {
      name: reference.name,
      mime: reference.type,
      base64: await fileBase64(reference),
    },
  });
}
export function renderFlowForm(reply: PanelReply): void {
  const batch = reply.batches.find(
    (candidate) => candidate.id === reply.activeBatchId,
  );
  const next =
    batch?.status === 'ready' &&
    reply.flow?.phase === 'ready' &&
    reply.flow.projectId === batch.projectId
      ? batch.projectId
      : null;
  if ((next !== projectId || batch?.id !== batchId) && approval) {
    approval.checked = false;
    pending = undefined;
  }
  projectId = next;
  batchId = batch?.status === 'ready' ? batch.id : null;
  connected = reply.state.phase === 'connected' && reply.queue !== null;
  if (submit)
    submit.disabled =
      busy || batchChanging || !connected || !projectId || !batchId;
}
export function setBatchChanging(changing: boolean): void {
  if (batchChanging === changing) return;
  batchChanging = changing;
  pending = undefined;
  if (approval) approval.checked = false;
  if (submit)
    submit.disabled = busy || changing || !connected || !projectId || !batchId;
}
export function initializeFlowForm(send: Send): void {
  if (!form || !feedback || !submit || !approval || !videoModel || !omniOptions)
    throw new Error('Flow form elements missing');
  const updateVideoOptions = (): void => {
    const omni = videoModel.value === 'omni_flash';
    omniOptions.hidden = !omni;
    for (const field of omniOptions.querySelectorAll<HTMLSelectElement>(
      'select',
    ))
      field.disabled = !omni;
  };
  videoModel.addEventListener('change', updateVideoOptions);
  updateVideoOptions();
  form.addEventListener('input', (event): void => {
    pending = undefined;
    if (event.target !== approval) approval.checked = false;
  });
  form.addEventListener('submit', (event): void => {
    event.preventDefault();
    if (
      busy ||
      batchChanging ||
      !connected ||
      !projectId ||
      !batchId ||
      !approval.checked
    )
      return;
    busy = true;
    submit.disabled = true;
    feedback.textContent = 'Preservando a referência e enfileirando o take…';
    void (async (): Promise<void> => {
      try {
        pending ??= await draft();
        const reply = await send({ type: 'enqueue-flow', flowDraft: pending });
        feedback.textContent =
          reply.operationError ??
          'Take enfileirado. Acompanhe a execução na fila abaixo.';
        if (!reply.operationError) {
          pending = undefined;
          approval.checked = false;
        }
      } catch {
        feedback.textContent =
          'Não foi possível enfileirar. Confira a conexão, os campos e a imagem de referência.';
      } finally {
        busy = false;
        submit.disabled = batchChanging || !connected || !projectId || !batchId;
      }
    })();
  });
}
