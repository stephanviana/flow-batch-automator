import {
  dispatchListSchema,
  queueSnapshotSchema,
  approvedImportSchema,
  stableImportId,
  type DispatchCommand,
  type ApprovedImport,
  type QueueSnapshot,
  type DispatchFailure,
} from '@flow-batch/protocol';
import { signedRequest, ApiError } from './api.js';
import { preferences, readState } from './state.js';
import { prepareDispatchBatch } from './batch-client.js';
import { readDispatchMaterials } from './dispatch-materials.js';
import { preserveImportFiles } from './dispatch-files.js';
import {
  buildImportPlan,
  approveImport,
  importFingerprint,
} from './dispatch-plan.js';
import { FlowInputError } from './flow-errors.js';
import { pruneReferences } from './flow-assets.js';
import { z } from 'zod';

async function status(message: string): Promise<void> {
  await chrome.storage.local.set({ dispatchStatus: message });
}
async function paused(command: DispatchCommand): Promise<boolean> {
  const stored = await chrome.storage.local.get('dispatchPausedAt');
  return (
    typeof stored.dispatchPausedAt === 'number' &&
    stored.dispatchPausedAt >= command.authorization.approvedAt
  );
}
async function finish(
  clientId: string,
  command: DispatchCommand,
  state: 'pending' | 'queued' | 'blocked',
  message: string,
  failure?: DispatchFailure,
): Promise<void> {
  await signedRequest(clientId, 'POST', '/api/dispatch', {
    id: command.id,
    state,
    message,
    ...(failure ? { failure } : {}),
  });
  await status(message);
}
async function snapshot(clientId: string): Promise<QueueSnapshot> {
  return queueSnapshotSchema.parse(
    await signedRequest(clientId, 'GET', '/api/queue'),
  );
}
function occupied(queue: QueueSnapshot): boolean {
  return (
    queue.counts.queued > 0 ||
    queue.tasks.some((task) =>
      [
        'dispatching',
        'submitted',
        'generating',
        'download_pending',
        'uncertain',
      ].includes(task.state),
    )
  );
}

async function prepareApprovedDispatch(
  clientId: string,
  command: DispatchCommand,
  batchId: string,
): Promise<ApprovedImport> {
  await finish(
    clientId,
    command,
    'pending',
    'Obtendo e verificando as referências aprovadas do pedido…',
  );
  const prepared = await readDispatchMaterials(command);
  await finish(
    clientId,
    command,
    'pending',
    'Referências conferidas. Preparando ou recuperando o projeto do lote…',
  );
  const batch = await prepareDispatchBatch(clientId, {
    id: batchId,
    name: command.name,
    mode: 'new-project',
  });
  const preserved = await preserveImportFiles(
    command.manifest,
    batch.id,
    prepared.files,
  );
  const candidate = buildImportPlan(
    command.manifest,
    batch,
    preserved.references,
    preserved.taskKeys,
  );
  const key = `dispatch-approval-${clientId}-${command.id}-${await importFingerprint(candidate)}`;
  const stored = (await chrome.storage.local.get(key))[key] as unknown;
  const approved =
    stored === undefined
      ? approveImport(candidate, command.authorization.approvedAt)
      : approvedImportSchema.parse(stored);
  await chrome.storage.local.set({ [key]: approved });
  return approved;
}

async function recoverQueued(
  clientId: string,
  command: DispatchCommand,
  batchId: string,
  queue: QueueSnapshot,
): Promise<boolean> {
  const keys = await Promise.all(
    command.manifest.tasks.map((take) =>
      stableImportId(['flow-import-v1', batchId, command.manifest.id, take.id]),
    ),
  );
  const existing = queue.tasks.filter((task) => keys.includes(task.taskKey));
  if (!existing.length) return false;
  if (existing.length !== keys.length)
    throw new FlowInputError(
      'O pedido tem registro parcial incompatível. Revise a fila.',
    );
  await finish(
    clientId,
    command,
    'queued',
    'Pedido já registrado. Nenhum take foi repetido e a pausa atual foi preservada.',
  );
  return true;
}

async function execute(
  clientId: string,
  command: DispatchCommand,
  queue: QueueSnapshot,
): Promise<void> {
  if (command.authorization.expiresAt <= Date.now()) {
    await finish(
      clientId,
      command,
      'blocked',
      'Autorização do pedido expirou. Solicite uma revisão pelo chat.',
    );
    return;
  }
  if (await paused(command)) return;
  const batchId = await stableImportId([
    'flow-dispatch-v1',
    clientId,
    command.manifest.id,
  ]);
  if (
    (await recoverQueued(clientId, command, batchId, queue)) ||
    occupied(queue)
  )
    return;
  await status(
    `${command.name}: verificando referências e preparando o projeto…`,
  );
  const approved = await prepareApprovedDispatch(clientId, command, batchId);
  if (command.authorization.expiresAt <= Date.now())
    throw new FlowInputError(
      'A autorização expirou durante a preparação. Solicite revisão pelo chat.',
    );
  if (await paused(command)) return;
  await signedRequest(clientId, 'POST', '/api/queue', approved);
  if (!(await paused(command)))
    await signedRequest(clientId, 'POST', '/api/queue/control', {
      action: 'start',
    });
  await finish(
    clientId,
    command,
    'queued',
    `${command.name}: ${command.manifest.tasks.length} takes enfileirados. Acompanhe as etapas na fila.`,
  );
}

export async function processDispatches(): Promise<void> {
  const config = await preferences();
  if (
    !config.clientId ||
    config.revoked ||
    (await readState()).phase !== 'connected'
  )
    return;
  const clientId = config.clientId;
  try {
    const { commands } = dispatchListSchema.parse(
      await signedRequest(clientId, 'GET', '/api/dispatch'),
    );
    for (const record of commands) {
      if (record.state !== 'pending') continue;
      if (await paused(record.command)) {
        const message =
          'Pedido aguardando retomada: a fila foi pausada após esta autorização.';
        if (record.message !== message)
          await finish(clientId, record.command, 'pending', message);
        continue;
      }
      try {
        await execute(clientId, record.command, await snapshot(clientId));
      } catch (error) {
        if (error instanceof ApiError && error.status !== 409) throw error;
        await finish(
          clientId,
          record.command,
          'blocked',
          error instanceof FlowInputError
            ? error.message.slice(0, 300)
            : 'Preparação bloqueada. Confira os materiais do pedido e o estado do projeto. Solicite revisão pelo chat.',
          error instanceof FlowInputError ? error.failure : undefined,
        );
      }
      // Complete one command at a time; next batches wait for the current queue.
      break;
    }
    const { retained } = z
      .object({ retained: z.array(z.uuid()) })
      .parse(await signedRequest(clientId, 'GET', '/api/materials'));
    await pruneReferences(retained);
  } catch {
    await status(
      'Aguardando conexão com a caixa local de pedidos. Nenhum reenvio pago foi autorizado.',
    );
  }
}
