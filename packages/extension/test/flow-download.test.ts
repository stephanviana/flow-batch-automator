import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { downloadVideo, FlowDownloadError } from '../src/flow-download.js';

const taskId = '11111111-1111-4111-8111-111111111111';
const videoUrl =
  'https://flow-content.google/video/22222222-2222-4222-8222-222222222222?signature=fixture';
interface DownloadState {
  state: string;
  exists: boolean;
  mime: string;
  fileSize: number;
}
function fixture(
  t: TestContext,
  search: () => Promise<DownloadState[]>,
  expectedFilename = `FlowBatch/${taskId}/take.mp4`,
): {
  signal: AbortSignal;
  emit: () => void;
  listenerCount: () => number;
} {
  const callbacks = new Set<(event: chrome.downloads.DownloadDelta) => void>();
  const controller = new AbortController();
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      downloads: {
        download: async (
          options: chrome.downloads.DownloadOptions,
        ): Promise<number> => {
          assert.equal(options.filename, expectedFilename);
          return 17;
        },
        search,
        onChanged: {
          addListener: (
            callback: (event: chrome.downloads.DownloadDelta) => void,
          ): void => {
            callbacks.add(callback);
          },
          removeListener: (
            callback: (event: chrome.downloads.DownloadDelta) => void,
          ): void => {
            callbacks.delete(callback);
          },
        },
      },
    },
  });
  t.after(() => {
    controller.abort();
    Reflect.deleteProperty(globalThis, 'chrome');
  });
  return {
    signal: controller.signal,
    emit: (): void => {
      for (const callback of callbacks)
        callback({ id: 17, state: { current: 'complete' } });
    },
    listenerCount: (): number => callbacks.size,
  };
}

test(
  'a completion event during an older in-flight search still finishes the MP4 download',
  { timeout: 2000 },
  async (t) => {
    let resolveFirst: ((value: DownloadState[]) => void) | undefined;
    let calls = 0;
    const f = fixture(t, async () => {
      calls++;
      if (calls === 1)
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      return [
        { state: 'complete', exists: true, mime: 'video/mp4', fileSize: 1716 },
      ];
    });
    const download = downloadVideo(videoUrl, taskId, f.signal, async () => {});
    await nextTurn();
    assert.ok(resolveFirst);
    f.emit();
    resolveFirst([
      { state: 'in_progress', exists: true, mime: 'video/mp4', fileSize: 0 },
    ]);
    assert.deepEqual(await download, {
      downloadId: 17,
      outputFile: `FlowBatch/${taskId}/take.mp4`,
    });
    assert.equal(f.listenerCount(), 0);
  },
);

test('HTML and other video containers cannot be reported as a completed MP4', async (t) => {
  for (const mime of ['text/html', 'video/webm']) {
    const f = fixture(t, async () => [
      { state: 'complete', exists: true, mime, fileSize: 100 },
    ]);
    await assert.rejects(
      downloadVideo(videoUrl, taskId, f.signal, async () => {}),
      FlowDownloadError,
    );
    assert.equal(f.listenerCount(), 0);
  }
});

test('grouped download uses the approved variation folder without changing Chrome download settings', async (t) => {
  const output = { directory: 'lote/variacao', filename: '03-CTA.mp4' };
  const expected = 'FlowBatch/lote/variacao/03-CTA.mp4';
  const f = fixture(
    t,
    async () => [
      { state: 'complete', exists: true, mime: 'video/mp4', fileSize: 1716 },
    ],
    expected,
  );
  assert.deepEqual(
    await downloadVideo(videoUrl, taskId, f.signal, async () => {}, output),
    {
      downloadId: 17,
      outputFile: expected,
    },
  );
});

test('a completed item without a file and a URL outside Flow are rejected', async (t) => {
  const f = fixture(t, async () => [
    { state: 'complete', exists: false, mime: 'video/mp4', fileSize: 1716 },
  ]);
  await assert.rejects(
    downloadVideo(videoUrl, taskId, f.signal, async () => {}),
    FlowDownloadError,
  );
  await assert.rejects(
    downloadVideo(
      'https://example.com/video/anything',
      taskId,
      f.signal,
      async () => {},
    ),
    FlowDownloadError,
  );
});
