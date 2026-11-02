import { flowOutputPath, type FlowOutput } from '@flow-batch/protocol';

export class FlowDownloadError extends Error {}

export async function downloadVideo(
  url: string,
  taskId: string,
  signal: AbortSignal,
  started: (id: number) => Promise<void>,
  output?: FlowOutput,
): Promise<{ downloadId: number; outputFile: string }> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'flow-content.google' ||
    parsed.port ||
    !/^\/video\/[a-zA-Z0-9_-]+$/.test(parsed.pathname) ||
    parsed.username ||
    parsed.password
  )
    throw new FlowDownloadError(
      'O Flow retornou um endereço de vídeo incompatível.',
    );
  signal.throwIfAborted();
  const outputFile = flowOutputPath(taskId, output);
  const downloadId = await chrome.downloads.download({
    url,
    filename: outputFile,
    saveAs: false,
    conflictAction: 'uniquify',
  });
  await started(downloadId);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.downloads.onChanged.removeListener(changed);
      signal.removeEventListener('abort', aborted);
      if (error) reject(error);
      else resolve();
    };
    const inspect = async (): Promise<void> => {
      if (settled) return;
      try {
        const [download] = await chrome.downloads.search({ id: downloadId });
        if (settled) return;
        if (!download || download.state === 'interrupted')
          finish(
            new FlowDownloadError(
              'O download foi interrompido. Confira os downloads do Chrome.',
            ),
          );
        else if (download.state === 'complete') {
          if (
            !download.exists ||
            download.fileSize <= 0 ||
            download.mime !== 'video/mp4'
          )
            finish(
              new FlowDownloadError(
                'O Chrome não confirmou um arquivo de vídeo válido.',
              ),
            );
          else finish();
        }
      } catch {
        finish(
          new FlowDownloadError(
            'Não foi possível confirmar o download no Chrome.',
          ),
        );
      }
    };
    const changed = (delta: chrome.downloads.DownloadDelta): void => {
      if (delta.id === downloadId && (delta.state || delta.error))
        void inspect();
    };
    const aborted = (): void =>
      finish(
        new FlowDownloadError(
          'A conexão foi interrompida. Confira o download antes de tentar novamente.',
        ),
      );
    const timeout = setTimeout(
      () =>
        finish(
          new FlowDownloadError(
            'O download ainda não foi confirmado. Confira o Chrome.',
          ),
        ),
      180000,
    );
    chrome.downloads.onChanged.addListener(changed);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    else void inspect();
  });
  return { downloadId, outputFile };
}
