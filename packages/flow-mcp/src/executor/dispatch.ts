import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  dispatchListSchema,
  queueSnapshotSchema,
  approvedImportSchema,
  referenceFileSchema,
  stableImportId,
  importTaskKey,
  buildImportPlan,
  approveImport,
  type DispatchCommand,
  type FlowReference,
} from '@flow-batch/protocol';
import type { ProfileBrowser } from '../browser.js';
import type { ExecutorApi } from './api.js';
import { prepareBrowserBatch } from './batch.js';
import { ExecutionError } from './errors.js';

async function materials(
  api: ExecutorApi,
  home: string,
  command: DispatchCommand,
  taskKeys: string[],
): Promise<FlowReference[]> {
  const directory = join(home, 'references');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const references = new Map<string, Omit<FlowReference, 'assetId'>>();
  for (const approved of command.references) {
    const content = referenceFileSchema.parse(
      await api.call('POST', '/api/materials', {
        dispatchId: command.id,
        path: approved.path,
      }),
    );
    const bytes = Buffer.from(content.base64, 'base64');
    if (
      bytes.length !== approved.size ||
      createHash('sha256').update(bytes).digest('hex') !== approved.sha256 ||
      content.name !== approved.path
    )
      throw new ExecutionError(
        'material_changed',
        'O material recebido difere da referência aprovada.',
        true,
      );
    references.set(approved.path, {
      name: content.name,
      mime: content.mime,
      bytes: bytes.length,
      sha256: approved.sha256,
    });
    for (const [index, take] of command.manifest.tasks.entries()) {
      if (take.reference !== approved.path) continue;
      const assetId = await stableImportId([
        'flow-browser-reference-v1',
        api.clientId,
        taskKeys[index]!,
        approved.sha256,
      ]);
      const target = join(directory, `${assetId}.bin`);
      try {
        await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
          createHash('sha256')
            .update(await readFile(target))
            .digest('hex') !== approved.sha256
        )
          throw new ExecutionError(
            'material_persistence_failed',
            'O material local não pôde ser preservado sem substituir um registro anterior.',
            true,
          );
      }
    }
  }
  return Promise.all(
    command.manifest.tasks.map(async (take, index): Promise<FlowReference> => {
      const reference = references.get(take.reference);
      if (!reference)
        throw new ExecutionError(
          'reference_missing',
          'Referência autorizada ausente.',
          true,
        );
      return {
        ...reference,
        assetId: await stableImportId([
          'flow-browser-reference-v1',
          api.clientId,
          taskKeys[index]!,
          reference.sha256,
        ]),
      };
    }),
  );
}

async function prepare(
  api: ExecutorApi,
  browser: ProfileBrowser,
  home: string,
  command: DispatchCommand,
  batchId: string,
  keys: string[],
  signal: AbortSignal,
): Promise<void> {
  const references = await materials(api, home, command, keys);
  signal.throwIfAborted();
  const batch = await prepareBrowserBatch(
    api,
    browser,
    home,
    batchId,
    command.name,
    signal,
  );
  const candidate = buildImportPlan(
    command.manifest,
    batch,
    references,
    keys,
    'browser-ui',
  );
  const path = join(home, `dispatch-${command.id}.json`);
  let approved;
  try {
    approved = approvedImportSchema.parse(
      JSON.parse(await readFile(path, 'utf8')),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new ExecutionError(
        'dispatch_receipt_invalid',
        'A importação anterior exige revisão.',
        true,
      );
    approved = approveImport(candidate, command.authorization.approvedAt);
    await writeFile(path, JSON.stringify(approved), {
      flag: 'wx',
      mode: 0o600,
    });
  }
  if (
    JSON.stringify(
      approved.tasks.map((take) => ({
        ...take,
        flow:
          take.executor === 'google-flow'
            ? {
                ...take.flow,
                approval: { ...take.flow.approval, approvedAt: 1 },
              }
            : undefined,
      })),
    ) !== JSON.stringify(candidate.tasks)
  )
    throw new ExecutionError(
      'dispatch_receipt_changed',
      'A importação salva difere dos materiais e parâmetros aprovados.',
      true,
    );
  if (command.authorization.expiresAt <= Date.now()) return;
  signal.throwIfAborted();
  await api.call('POST', '/api/queue', approved);
  await api.call('POST', '/api/queue/control', { action: 'start' });
  await api.call('POST', '/api/dispatch', {
    id: command.id,
    state: 'queued',
    message: 'Pedido registrado no executor local. Consulte os takes no chat.',
  });
}

export async function processBrowserDispatch(
  api: ExecutorApi,
  browser: ProfileBrowser,
  home: string,
  signal: AbortSignal,
): Promise<void> {
  const queue = queueSnapshotSchema.parse(await api.call('GET', '/api/queue'));
  const records = dispatchListSchema.parse(
    await api.call('GET', '/api/dispatch'),
  );
  const record = records.commands.find(
    (entry) =>
      entry.state === 'pending' && entry.command.authorization.approvedAt > 0,
  );
  if (!record) return;
  const command = record.command;
  const batchId = await stableImportId([
    'flow-dispatch-v1',
    api.clientId,
    command.manifest.id,
  ]);
  const keys = await Promise.all(
    command.manifest.tasks.map((take) =>
      importTaskKey(batchId, command.manifest.id, take.id),
    ),
  );
  const existing = queue.tasks.filter((take) => keys.includes(take.taskKey));
  if (existing.length === keys.length) {
    await api.call('POST', '/api/dispatch', {
      id: command.id,
      state: 'queued',
      message: 'Pedido já registrado; nenhuma tentativa foi repetida.',
    });
    return;
  }
  if (existing.length) {
    await api.call('POST', '/api/dispatch', {
      id: command.id,
      state: 'blocked',
      message:
        'O pedido tem registro parcial incompatível. Solicite revisão no chat.',
    });
    return;
  }
  if (
    queue.counts.queued > 0 ||
    queue.tasks.some((take) =>
      [
        'dispatching',
        'submitted',
        'generating',
        'download_pending',
        'uncertain',
      ].includes(take.state),
    )
  )
    return;
  try {
    if (command.authorization.expiresAt <= Date.now())
      throw new ExecutionError(
        'dispatch_review_required',
        'A autorização expirou. Solicite revisão no chat.',
        true,
      );
    await prepare(api, browser, home, command, batchId, keys, signal);
  } catch (error) {
    if (signal.aborted) return;
    const known = error instanceof ExecutionError ? error : undefined;
    if (known?.code === 'queue_dispatch_paused') return;
    await api.call('POST', '/api/dispatch', {
      id: command.id,
      state: 'blocked',
      message:
        known?.message ??
        'Despacho bloqueado. Confira os materiais, a conexão e o projeto antes de outra tentativa.',
      ...(known &&
      ['project_creation_not_sent', 'project_creation_unknown'].includes(
        known.code,
      )
        ? {
            failure: {
              stage: 'project-creation',
              code: known.code,
              sent: !known.notSubmitted,
            },
          }
        : {}),
    });
  }
}
