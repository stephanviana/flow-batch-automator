import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import {
  taskStateSchema,
  taskSummarySchema,
  popupReplySchema,
} from '../packages/protocol/dist/index.js';

const directory = resolve('.cache', `queue-design-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const base = 'http://127.0.0.1:4399';
const task = taskSummarySchema.parse({
  id: randomUUID(),
  taskKey: randomUUID(),
  executor: 'google-flow',
  product: 'Kit com 12 Potes Plásticos',
  video: 'full-pov · full-pov 1',
  format: '9:16',
  take: '03-CTA',
  state: 'generating',
  step: 'video_submitted',
  attemptCount: 1,
  maxAttempts: 1,
  revision: 1,
  createdAt: Date.now() - 30000,
  updatedAt: Date.now() - 10000,
  nextAttemptAt: 1,
  generationId: null,
  safeToRetry: false,
  result: null,
  lastError: null,
});
function reply(current, running = true) {
  return popupReplySchema.parse({
    state: {
      phase: 'connected',
      message: 'Conexão sintética para validar o layout.',
    },
    simulations: [],
    dispatchIssues: [],
    inspection: null,
    operationError: null,
    flow: null,
    queue: {
      running,
      blockedByReview: current?.state === 'uncertain',
      tasks: current ? [current] : [],
      counts: Object.fromEntries(
        taskStateSchema.options.map((state) => [
          state,
          Number(current?.state === state),
        ]),
      ),
    },
  });
}
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 380, height: 1000 },
  });
  context.setDefaultTimeout(15000);
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  // Serve only the built extension assets. No server, account or paid generation.
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, base);
    const filename = url.pathname.slice(1);
    assert.match(
      filename,
      /^(?:sidepanel\.html|sidepanel\.js|sidepanel\.css|theme\.css|queue-activity\.css)$/,
    );
    const types = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
    };
    await route.fulfill({
      contentType: types[extname(filename)],
      body: await readFile(resolve('packages/extension/dist', filename)),
    });
  });
  await page.addInitScript((fixture) => {
    globalThis.queueDesignFixture = fixture;
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          sendMessage: async () =>
            globalThis.structuredClone(globalThis.queueDesignFixture),
        },
        storage: { local: { get: async () => ({}) } },
      },
    });
  }, reply(task));
  await page.goto(`${base}/sidepanel.html`);
  await page.getByRole('tab', { name: 'Fila e gerações', exact: true }).click();
  await page
    .locator('#queue-activity-title')
    .filter({ hasText: 'Gerando vídeo no Flow' })
    .waitFor();
  assert.equal(
    await page.locator('#queue-activity-product').textContent(),
    task.product,
  );
  assert.match(
    await page.locator('#queue-activity-meta').textContent(),
    /Full POV · Variação 1 · Take 03 — CTA/,
  );
  assert.equal(
    await page.locator('#queue-activity-detail').textContent(),
    'Etapa 3 de 4',
  );
  assert.deepEqual(
    await page.locator('#queue-steps .step-status').allTextContents(),
    ['Concluída', 'Concluída', 'Em andamento', 'Aguardando'],
  );
  assert.equal(
    await page
      .locator('#queue-steps [aria-current="step"] .step-label')
      .textContent(),
    'Vídeo',
  );
  assert.match(
    await page.locator('#queue-steps .step-time:visible').textContent(),
    /Há \d+ s nesta etapa/,
  );
  for (const width of [280, 320, 380, 640]) {
    await page.setViewportSize({ width, height: 1100 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
      true,
    );
    const rows = await page.locator('#queue-steps li').evaluateAll((elements) =>
      elements.map((row) => {
        const marker = row
          .querySelector('.step-marker')
          .getBoundingClientRect();
        const caption = row
          .querySelector('.step-content')
          .getBoundingClientRect();
        const status = row
          .querySelector('.step-status')
          .getBoundingClientRect();
        return {
          top: marker.top,
          markerRight: marker.right,
          captionLeft: caption.left,
          captionRight: caption.right,
          statusLeft: status.left,
        };
      }),
    );
    assert.ok(
      rows.every(
        (row, index) =>
          (!index || row.top > rows[index - 1].top) &&
          row.markerRight < row.captionLeft &&
          row.captionRight <= row.statusLeft,
      ),
    );
    await page.screenshot({
      path: resolve(directory, `queue-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page
      .locator('#queue-steps [data-icon="working"]')
      .evaluate((node) => globalThis.getComputedStyle(node).animationName),
    'none',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 380, height: 1100 });
  let revision = task.revision;
  const show = async (current, running = true) => {
    await page.evaluate(
      (fixture) => {
        globalThis.queueDesignFixture = fixture;
      },
      reply({ ...current, revision: ++revision }, running),
    );
    await page.waitForFunction(
      ({ state, step }) => {
        const card = document.querySelector('#queue-tasks > li');
        const detail = document.querySelector(
          '#queue-activity-detail',
        ).textContent;
        return (
          card?.dataset.state === state && (!step || detail.includes(step))
        );
      },
      {
        state: current.state,
        step: current.state === 'download_pending' ? 'Etapa 4 de 4' : '',
      },
    );
  };
  await show({ ...task, state: 'download_pending', step: 'download_started' });
  assert.equal(
    await page
      .locator('#queue-steps li')
      .last()
      .locator('.step-status')
      .textContent(),
    'Em andamento',
  );
  assert.equal(
    await page.locator('#queue-activity').getAttribute('data-tone'),
    'working',
  );
  await show({ ...task, state: 'uncertain' });
  assert.equal(
    await page.locator('#queue-activity').getAttribute('data-busy'),
    'false',
  );
  assert.equal(
    await page.locator('#queue-steps [data-icon="working"]').count(),
    0,
  );
  assert.equal(
    await page
      .locator('#queue-steps [aria-current="step"] .step-status')
      .textContent(),
    'Revisão necessária',
  );
  await page.screenshot({
    path: resolve(directory, 'queue-review.png'),
    fullPage: true,
  });
  await show({ ...task, state: 'failed' });
  assert.equal(
    await page
      .locator('#queue-steps [aria-current="step"] .step-status')
      .textContent(),
    'Interrompida',
  );
  await show({ ...task, state: 'completed' });
  assert.equal(
    await page.locator('#queue-steps [data-status="done"]').count(),
    4,
  );
  assert.equal(
    await page.locator('#queue-steps [aria-current="step"]').count(),
    0,
  );
  await show(task, false);
  await page.locator('#queue-activity-note:visible').waitFor();
  assert.equal(
    await page.locator('#queue-activity').getAttribute('data-busy'),
    'true',
  );
  await page.evaluate((fixture) => {
    fixture.queue = null;
    fixture.operationError = 'Conexão interrompida.';
    globalThis.queueDesignFixture = fixture;
  }, reply(null));
  await page
    .locator('#queue-activity-title')
    .filter({ hasText: 'Não foi possível atualizar a fila' })
    .waitFor();
  assert.equal(await page.locator('#queue-activity-task').isVisible(), false);
  assert.equal(await page.locator('#queue-steps').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(
    'Chrome layout fixtures: reference design, vertical steps, 280–640 px, timers, reduced motion, download pending, review, failure, completion, pause and unavailable states passed. No dispatch or generation.',
  );
  console.log(`Evidence: ${directory}`);
} finally {
  await browser.close();
}
