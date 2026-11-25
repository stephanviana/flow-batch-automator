import { mkdir, open, copyFile, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type { Page } from 'playwright-core';
import { flowOutputPath, type FlowExecute } from '@flow-batch/protocol';
import { ExecutionError } from './errors.js';

interface Begun {
  guid: string;
  url: string;
  suggestedFilename: string;
  frameId: string;
}
interface Progress {
  guid: string;
  state: string;
  totalBytes: number;
  receivedBytes: number;
}

export async function downloadClip(
  page: Page,
  home: string,
  command: FlowExecute,
  videoUrl: string,
  signal: AbortSignal,
  started: (guid: string) => void,
): Promise<{ downloadId: string; outputFile: string }> {
  const staging = join(home, 'downloads');
  await mkdir(staging, { recursive: true, mode: 0o700 });
  const cdp = await page.context().newCDPSession(page);
  const tree = await cdp.send('Page.getFrameTree');
  const frameId = tree.frameTree.frame.id;
  const suggested = `${command.attemptId}.mp4`;
  let guid: string | undefined;
  let blobUrl: string | undefined;
  let cleanup: () => void = () => {};
  try {
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allowAndName',
      downloadPath: staging,
      eventsEnabled: true,
    });
    const finished = new Promise<{ guid: string; bytes: number }>(
      (accept, reject) => {
        const timeout = setTimeout(
          () =>
            reject(
              new ExecutionError(
                'flow_download_timeout',
                'O Chrome não confirmou o download. Confira os arquivos antes de repetir.',
                false,
              ),
            ),
          180000,
        );
        const abort = (): void =>
          reject(
            new ExecutionError(
              'flow_download_interrupted',
              'O download foi interrompido. Confira o Chrome e os arquivos.',
              false,
            ),
          );
        const begin = (event: Begun): void => {
          if (
            event.frameId !== frameId ||
            event.suggestedFilename !== suggested ||
            !event.url.startsWith('blob:https://flow.google.com/')
          )
            return;
          if (guid) {
            reject(
              new ExecutionError(
                'flow_download_ambiguous',
                'O Chrome iniciou mais de um download correspondente.',
                false,
              ),
            );
            return;
          }
          guid = event.guid;
          started(guid);
        };
        const progress = (event: Progress): void => {
          if (event.guid !== guid) return;
          if (event.state === 'canceled')
            reject(
              new ExecutionError(
                'flow_download_canceled',
                'O Chrome cancelou o download do vídeo.',
                false,
              ),
            );
          if (
            event.state === 'completed' &&
            event.totalBytes > 0 &&
            event.totalBytes === event.receivedBytes
          )
            accept({ guid: event.guid, bytes: event.totalBytes });
        };
        cdp.on('Browser.downloadWillBegin', begin);
        cdp.on('Browser.downloadProgress', progress);
        signal.addEventListener('abort', abort, { once: true });
        cleanup = (): void => {
          clearTimeout(timeout);
          signal.removeEventListener('abort', abort);
          cdp.off('Browser.downloadWillBegin', begin);
          cdp.off('Browser.downloadProgress', progress);
        };
      },
    );
    void finished.catch(() => {});
    signal.throwIfAborted();
    blobUrl = await page.evaluate(
      async ({ url, name }) => {
        const response = await fetch(url, {
          credentials: 'include',
          redirect: 'error',
          signal: AbortSignal.timeout(120000),
        });
        if (!response.ok) throw new Error('Video download unavailable');
        const blob = await response.blob();
        if (
          blob.size < 12 ||
          blob.size > 268435456 ||
          !blob.type.startsWith('video/')
        )
          throw new Error('Invalid video');
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = name;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        return objectUrl;
      },
      { url: videoUrl, name: suggested },
    );
    const completed = await finished;
    signal.throwIfAborted();
    const source = join(staging, completed.guid);
    await verifyMp4(source, completed.bytes);
    const outputFile = flowOutputPath(command.taskId, command.flow.output);
    const root = resolve(
      process.env.FLOW_BROWSER_DOWNLOADS_DIR ?? join(homedir(), 'Downloads'),
    );
    const target = resolve(root, outputFile);
    if (!target.startsWith(root + sep))
      throw new ExecutionError(
        'flow_download_destination',
        'Destino inválido para o download.',
        false,
      );
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target, constants.COPYFILE_EXCL).catch(
      (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        throw new ExecutionError(
          'flow_download_exists',
          'O destino já contém um arquivo. O vídeo foi localizado; preserve os arquivos e revise o download sem gerar novamente.',
          false,
        );
      },
    );
    await verifyMp4(target, completed.bytes);
    await unlink(source);
    return { downloadId: completed.guid, outputFile };
  } finally {
    cleanup();
    if (blobUrl)
      await page
        .evaluate((url) => URL.revokeObjectURL(url), blobUrl)
        .catch(() => {});
    await cdp
      .send('Browser.setDownloadBehavior', {
        behavior: 'default',
        eventsEnabled: false,
      })
      .catch(() => {});
    await cdp.detach().catch(() => {});
  }
}

async function verifyMp4(path: string, bytes: number): Promise<void> {
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(12);
    await file.read(header, 0, 12, 0);
    if (
      (await file.stat()).size !== bytes ||
      header.subarray(4, 8).toString('ascii') !== 'ftyp'
    )
      throw new ExecutionError(
        'flow_download_invalid',
        'O arquivo não corresponde ao MP4 confirmado pelo Chrome.',
        false,
      );
  } finally {
    await file.close();
  }
}
