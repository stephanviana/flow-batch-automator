import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import {
  flowExecuteSchema,
  type FlowExecute,
  type QueueCheckpoint,
  type QueueProgress,
} from '@flow-batch/protocol';
import { ProfileBrowser } from '../src/browser.js';
import { BrowserTakeExecutor } from '../src/executor/take.js';
import {
  generationHtml,
  envelope,
  PROJECT,
  SOURCE,
  GENERATED,
  PNG,
  MP4,
} from './generation-fixture.js';

interface Fixture {
  home: string;
  destination: string;
  page: Page;
  browser: Browser;
  executor: BrowserTakeExecutor;
}
async function fixture(
  t: TestContext,
  credits = 12,
  imageModel = true,
): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), 'flow-executor-browser-'));
  const destination = join(home, 'output');
  const prior = process.env.FLOW_BROWSER_DOWNLOADS_DIR;
  process.env.FLOW_BROWSER_DOWNLOADS_DIR = destination;
  const context = await chromium.launchPersistentContext(
    join(home, 'chrome-profile'),
    { headless: true, args: ['--remote-debugging-port=0'] },
  );
  await context.route('https://flow.google.com/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/batchexecute'))
      return route.fulfill({
        contentType: 'application/json',
        body: envelope(url.searchParams.get('rpcids') ?? ''),
      });
    return route.fulfill({
      contentType: 'text/html',
      body: generationHtml(credits, imageModel),
    });
  });
  await context.route('https://flow-content.google/**', (route) =>
    route.fulfill({
      contentType: 'video/mp4',
      body: MP4,
      headers: {
        'Access-Control-Allow-Origin': 'https://flow.google.com',
        'Access-Control-Allow-Credentials': 'true',
      },
    }),
  );
  const page = context.pages()[0]!;
  await page.goto(`https://flow.google.com/project/${PROJECT}`);
  const attached = new ProfileBrowser({
    home,
    profile: join(home, 'chrome-profile'),
    executable: undefined,
  });
  const browser = await attached.connect();
  assert.ok(browser);
  t.after(async () => {
    await attached.disconnect();
    await context.close();
    await rm(home, { recursive: true, force: true });
    if (prior === undefined) delete process.env.FLOW_BROWSER_DOWNLOADS_DIR;
    else process.env.FLOW_BROWSER_DOWNLOADS_DIR = prior;
  });
  return {
    home,
    destination,
    page,
    browser,
    executor: new BrowserTakeExecutor(attached, home),
  };
}

function command(reuse = false): FlowExecute {
  return flowExecuteSchema.parse({
    type: 'flow-execute',
    taskId: randomUUID(),
    attemptId: randomUUID(),
    attemptNumber: 1,
    original: {
      imagePrompt: 'Imagem preparada sem alteração.',
      videoPrompt:
        'Vídeo preparado sem alteração.\n\nSegunda linha com  dois espaços.',
      copy: 'Fala original.',
    },
    flow: {
      projectId: PROJECT,
      driver: 'browser-ui',
      seed: null,
      maxVideoCredits: 25,
      imageModel: 'GEM_PIX_2',
      videoModel: 'abra_i2v_8s',
      aspect: '9:16',
      reference: {
        assetId: randomUUID(),
        name: 'product.png',
        mime: 'image/png',
        bytes: PNG.byteLength,
        sha256: createHash('sha256').update(PNG).digest('hex'),
      },
      output: {
        root: 'Flow',
        directory: 'Videos/product--factory--fixture',
        filename: '01-Gancho.mp4',
      },
      approval: {
        approvedAt: Date.now(),
        imageGenerations: reuse ? 0 : 1,
        videoGenerations: 1,
      },
      ...(reuse ? { imageSourceTaskKey: randomUUID() } : {}),
    },
    ...(reuse
      ? { sourceImage: { taskId: randomUUID(), mediaId: SOURCE } }
      : {}),
  });
}

async function preserve(
  home: string,
  input: FlowExecute,
  bytes = PNG,
): Promise<void> {
  await mkdir(join(home, 'references'), { recursive: true });
  await writeFile(
    join(home, 'references', `${input.flow.reference.assetId}.bin`),
    bytes,
  );
}

test('UI generator preserves prompts and records five checkpoints plus a real Chrome download GUID', async (t) => {
  const f = await fixture(t);
  const input = command();
  await preserve(f.home, input);
  const events: (QueueCheckpoint | QueueProgress)[] = [];
  await f.executor.run(input, new AbortController().signal, (event) =>
    events.push(event),
  );
  const result = events.at(-1);
  assert.equal(result?.type, 'queue-progress');
  assert.ok(
    result?.type === 'queue-progress' && result.state === 'completed',
    JSON.stringify(events),
  );
  assert.ok(result.result && !result.result.simulated);
  assert.equal(typeof result.result.downloadId, 'string');
  assert.deepEqual(
    events
      .filter((event) => event.type === 'queue-checkpoint')
      .map((event) => event.stage),
    [
      'reference_uploaded',
      'image_generated',
      'video_submitted',
      'video_ready',
      'download_started',
    ],
  );
  assert.equal(result.result.imageMediaId, GENERATED);
  assert.deepEqual(
    await readFile(join(f.destination, result.result.outputFile)),
    MP4,
  );
  const counts = await f.page.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          counts: { images: number; videos: number };
        }
      ).counts,
  );
  assert.deepEqual(counts, { images: 1, videos: 1 });
  assert.deepEqual(
    await f.page.evaluate(
      () => (globalThis as typeof globalThis & { prompts: string[] }).prompts,
    ),
    [input.original.imagePrompt, input.original.videoPrompt],
  );
  await f.executor.run(input, new AbortController().signal, (event) =>
    events.push(event),
  );
  assert.deepEqual(
    await f.page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            counts: { images: number; videos: number };
          }
        ).counts,
    ),
    counts,
    'Duplicate receipt must never resubmit',
  );
});

test('UI reuse generates no image and preserves the source ID through the confirmed download', async (t) => {
  const f = await fixture(t);
  const input = command(true);
  const events: (QueueCheckpoint | QueueProgress)[] = [];
  await f.executor.run(input, new AbortController().signal, (event) =>
    events.push(event),
  );
  const result = events.at(-1);
  assert.ok(
    result?.type === 'queue-progress' && result.state === 'completed',
    JSON.stringify(events),
  );
  assert.deepEqual(
    events
      .filter((event) => event.type === 'queue-checkpoint')
      .map((event) => event.stage),
    ['image_reused', 'video_submitted', 'video_ready', 'download_started'],
  );
  assert.deepEqual(
    await f.page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            counts: { images: number; videos: number };
          }
        ).counts,
    ),
    { images: 0, videos: 1 },
  );
});

test('changed reference, unavailable model and excessive quote stop before a generation click', async (t) => {
  const changed = await fixture(t);
  const input = command();
  await preserve(changed.home, input, Buffer.from('changed'));
  const events: (QueueCheckpoint | QueueProgress)[] = [];
  await changed.executor.run(input, new AbortController().signal, (event) =>
    events.push(event),
  );
  assert.ok(events.at(-1)?.type === 'queue-progress');
  assert.match(JSON.stringify(events), /reference_changed/);
  assert.deepEqual(
    await changed.page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            counts: { images: number; videos: number };
          }
        ).counts,
    ),
    { images: 0, videos: 0 },
  );
  const missing = await fixture(t, 12, false);
  const unavailable = command();
  await preserve(missing.home, unavailable);
  const missingEvents: (QueueCheckpoint | QueueProgress)[] = [];
  await missing.executor.run(
    unavailable,
    new AbortController().signal,
    (event) => missingEvents.push(event),
  );
  assert.match(JSON.stringify(missingEvents), /flow_model_unavailable/);
  const expensive = await fixture(t, 26);
  const expensiveEvents: (QueueCheckpoint | QueueProgress)[] = [];
  await expensive.executor.run(
    command(true),
    new AbortController().signal,
    (event) => expensiveEvents.push(event),
  );
  assert.match(JSON.stringify(expensiveEvents), /flow_credit_quote_exceeded/);
  assert.deepEqual(
    await expensive.page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            counts: { images: number; videos: number };
          }
        ).counts,
    ),
    { images: 0, videos: 0 },
  );
});

test('existing output is preserved and a confirmed video is never generated again after download collision', async (t) => {
  const f = await fixture(t);
  const input = command(true);
  const output = join(
    f.destination,
    'Flow',
    'Videos/product--factory--fixture',
    '01-Gancho.mp4',
  );
  await mkdir(join(f.destination, 'Flow', 'Videos/product--factory--fixture'), {
    recursive: true,
  });
  await writeFile(output, 'Existing result');
  const events: (QueueCheckpoint | QueueProgress)[] = [];
  await f.executor.run(input, new AbortController().signal, (event) =>
    events.push(event),
  );
  const result = events.at(-1);
  assert.ok(result?.type === 'queue-progress' && result.state === 'uncertain');
  assert.equal(result.error.code, 'flow_download_exists');
  assert.equal(result.error.notSubmitted, false);
  assert.equal(await readFile(output, 'utf8'), 'Existing result');
  assert.equal(
    events.filter(
      (event) =>
        event.type === 'queue-checkpoint' && event.stage === 'video_ready',
    ).length,
    1,
  );
  assert.deepEqual(
    await f.page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            counts: { images: number; videos: number };
          }
        ).counts,
    ),
    { images: 0, videos: 1 },
  );
});

test('settings radio selection waits for asynchronous state updates', async (t) => {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    document.querySelectorAll('[role=radio]').forEach((node) => {
      const element = node as HTMLElement;
      const prior = element.onclick;
      element.onclick = (event): void => {
        setTimeout(() => {
          prior?.call(element, event);
        }, 40);
      };
    });
  });
  const input = command();
  await preserve(f.home, input);
  const events: (QueueCheckpoint | QueueProgress)[] = [];
  await f.executor.run(input, new AbortController().signal, (event) =>
    events.push(event),
  );
  const result = events.at(-1);
  assert.ok(
    result?.type === 'queue-progress' && result.state === 'completed',
    JSON.stringify(events),
  );
});

test('execution succeeds when Flow Agent button is absent from the project UI', async (t) => {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    document.querySelector('[aria-label="Flow Agent"]')?.remove();
  });
  const input = command(true);
  const events: (QueueCheckpoint | QueueProgress)[] = [];
  await f.executor.run(input, new AbortController().signal, (event) =>
    events.push(event),
  );
  const result = events.at(-1);
  assert.ok(
    result?.type === 'queue-progress' && result.state === 'completed',
    JSON.stringify(events),
  );
});

test('retries reload the project with ?hl=en to preserve English UI selectors', async (t) => {
  const f = await fixture(t);
  const input = { ...command(true), attemptNumber: 2 };
  const events: (QueueCheckpoint | QueueProgress)[] = [];
  await f.executor.run(input, new AbortController().signal, (event) =>
    events.push(event),
  );
  const result = events.at(-1);
  assert.ok(
    result?.type === 'queue-progress' && result.state === 'completed',
    JSON.stringify(events),
  );
  assert.equal(new URL(f.page.url()).searchParams.get('hl'), 'en');
});

test('asset picker resolves delayed options and resized thumbnail URLs', async (t) => {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    const gridImg = document.querySelector('#grid img[data-media-id]');
    if (gridImg)
      gridImg.setAttribute(
        'src',
        'https://flow-content.google/thumb/item=w800?token=grid',
      );
    const originalShow = (
      globalThis as typeof globalThis & { showPicker?: () => void }
    ).showPicker;
    (globalThis as typeof globalThis & { showPicker?: () => void }).showPicker =
      (): void => {
        const picker = document.querySelector('#picker') as HTMLElement;
        picker.replaceChildren();
        picker.hidden = false;
        setTimeout(() => {
          originalShow?.();
          const optImg = picker.querySelector('img');
          if (optImg)
            optImg.setAttribute(
              'src',
              'https://flow-content.google/thumb/item=w128?token=picker',
            );
        }, 60);
      };
  });
  const input = command(true);
  const events: (QueueCheckpoint | QueueProgress)[] = [];
  await f.executor.run(input, new AbortController().signal, (event) =>
    events.push(event),
  );
  const result = events.at(-1);
  assert.ok(
    result?.type === 'queue-progress' && result.state === 'completed',
    JSON.stringify(events),
  );
});

test('asset picker ignores transient Add to prompt button when selection closes picker asynchronously', async (t) => {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    const add = document.createElement('button');
    add.setAttribute('aria-label', 'Add to prompt');
    add.textContent = 'Add to prompt';
    document.body.append(add);
    const originalShow = (
      globalThis as typeof globalThis & { showPicker?: () => void }
    ).showPicker;
    (globalThis as typeof globalThis & { showPicker?: () => void }).showPicker =
      (): void => {
        originalShow?.();
        const option = document.querySelector('#picker [role=option]');
        if (option instanceof HTMLElement) {
          option.onclick = (): void => {
            setTimeout(() => {
              (document.querySelector('#picker') as HTMLElement).hidden = true;
              add.remove();
            }, 80);
          };
        }
      };
  });
  const input = command(true);
  const events: (QueueCheckpoint | QueueProgress)[] = [];
  await f.executor.run(input, new AbortController().signal, (event) =>
    events.push(event),
  );
  const result = events.at(-1);
  assert.ok(
    result?.type === 'queue-progress' && result.state === 'completed',
    JSON.stringify(events),
  );
});
