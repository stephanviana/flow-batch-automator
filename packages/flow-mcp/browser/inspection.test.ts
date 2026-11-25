import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { chromium, type Browser, type Page } from 'playwright-core';
import { ProfileBrowser, profileEndpoint } from '../src/browser.js';
import { browserConfig } from '../src/config.js';
import { FlowBrowserService } from '../src/service.js';

const firstProject = '11111111-1111-4111-8111-111111111111';
const secondProject = '22222222-2222-4222-8222-222222222222';
const html = `<!doctype html><html lang="pt-BR"><style>
.page-container { height: 120px; overflow: auto; }
flow-grid-tile-container { display: block; height: 60px; }
</style><div class="ProseMirror" contenteditable="true"></div>
<div class="page-container">
<flow-grid-tile-container aria-label="Mesmo título"><flow-image-tile><img data-media-id="image-a"></flow-image-tile></flow-grid-tile-container>
<flow-grid-tile-container aria-label="Mesmo título"><flow-image-tile><img data-media-id="image-b"></flow-image-tile></flow-grid-tile-container>
<flow-grid-tile-container aria-label="Vídeo"><flow-video-tile><video data-media-id="video-a"></video></flow-video-tile></flow-grid-tile-container>
<flow-grid-tile-container aria-label="Sem ID"><flow-image-tile><img src="https://flow.google.com/asb/thumbnail?token=SECRET_SIGNED_TOKEN"></flow-image-tile></flow-grid-tile-container>
<flow-grid-tile-container aria-label="Coleção"><flow-collection-tile><img data-media-id="collection-a"></flow-collection-tile></flow-grid-tile-container>
<flow-grid-tile-container aria-label="Falha"><flow-error-tile></flow-error-tile></flow-grid-tile-container>
</div><button onclick="throw new Error('Generation forbidden in fixture')">Start generation</button></html>`;

async function fixture(
  t: TestContext,
): Promise<{ browser: Browser; page: Page; service: FlowBrowserService }> {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  await context.route('**/*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  const page = await context.newPage();
  await page.goto(`https://flow.google.com/project/${firstProject}?hl=pt`);
  const service = new FlowBrowserService({
    connect: async (): Promise<Browser> => browser,
    page: async (): Promise<Page> => page,
    launch: async (): Promise<void> => {},
    login: async (): Promise<void> => {},
    isLoginOpen: async (): Promise<boolean> => false,
    reserve: async () => async (): Promise<void> => {},
  });
  return { browser, page, service };
}

test('Chrome fixture: reads session, finds exact image, excludes signed URLs and preserves the tab and scroll', async (t) => {
  const { browser, page, service } = await fixture(t);
  let clicks = 0;
  await page.exposeFunction('generationClicked', () => {
    clicks++;
  });
  await page.locator('button').evaluate((button) =>
    button.addEventListener('click', () => {
      void (
        globalThis as typeof globalThis & {
          generationClicked: () => Promise<void>;
        }
      ).generationClicked();
    }),
  );
  assert.equal((await service.status()).phase, 'ready');
  assert.equal((await service.status()).language, 'pt-BR');
  await page.locator('.page-container').evaluate((scroller) => {
    scroller.scrollTop = 60;
  });
  const originalUrl = page.url();
  const listing = await service.assets({ projectId: firstProject });
  assert.deepEqual(
    listing.assets.map(({ mediaId }) => mediaId),
    ['image-a', 'image-b', 'video-a'],
  );
  assert.equal(listing.unidentifiedTilesSeen, true);
  assert.equal(listing.reachedEnd, true);
  assert.doesNotMatch(JSON.stringify(listing), /SECRET_SIGNED_TOKEN|https:/);
  assert.equal(
    await page
      .locator('.page-container')
      .evaluate((scroller) => scroller.scrollTop),
    60,
  );
  assert.equal(
    (await service.findImage({ projectId: firstProject, mediaId: 'image-b' }))
      .image.mediaId,
    'image-b',
  );
  await assert.rejects(
    service.findImage({ projectId: firstProject, mediaId: 'missing' }),
    /não foi confirmada/,
  );
  assert.equal(browser.contexts()[0]!.pages().length, 1);
  assert.equal(page.url(), originalUrl);
  assert.equal(clicks, 0);
});

test('Chrome fixture: refuses active generation, changed project, drafts and editor views', async (t) => {
  const { page, service } = await fixture(t);
  await page
    .locator('flow-grid-tile-container')
    .first()
    .evaluate((tile) => {
      tile.innerHTML = '<span>42%</span> Rendering';
    });
  assert.equal((await service.status()).phase, 'busy');
  await assert.rejects(
    service.assets({ projectId: firstProject }),
    /geração em andamento/,
  );
  await assert.rejects(
    service.openProject(secondProject),
    /geração em andamento/,
  );
  await page.goto(`https://flow.google.com/project/${firstProject}`);
  await page.locator('.ProseMirror').fill('Texto que deve ser preservado');
  await assert.rejects(
    service.openProject(secondProject),
    /texto no compositor/,
  );
  assert.equal(
    await page.locator('.ProseMirror').innerText(),
    'Texto que deve ser preservado',
  );
  await assert.rejects(
    service.assets({ projectId: secondProject }),
    /não corresponde/,
  );
  await page.goto(`https://flow.google.com/project/${firstProject}/edit/clip`);
  await assert.rejects(
    service.assets({ projectId: firstProject }),
    /Volte à grade/,
  );
});

test('Chrome fixture: explicitly opens an existing project in the same tab and preserves login', async (t) => {
  const { browser, page, service } = await fixture(t);
  assert.equal(
    (await service.openProject(secondProject)).projectId,
    secondProject,
  );
  assert.equal(browser.contexts()[0]!.pages().length, 1);
  await page.goto('https://flow.google.com/about');
  assert.equal((await service.status()).phase, 'login-required');
  await assert.rejects(service.openProject(firstProject), /manualmente/);
  assert.equal(page.url(), 'https://flow.google.com/about');
  await page.goto(
    'https://accounts.google.com/signin?continue=PRIVATE_SESSION_DATA',
  );
  const loginStatus = await service.status();
  assert.equal(loginStatus.phase, 'login-required');
  assert.doesNotMatch(
    JSON.stringify(loginStatus),
    /PRIVATE_SESSION_DATA|accounts.google/,
  );
});

test('Chrome fixture: scans a virtual grid by ID without collapsing duplicate titles', async (t) => {
  const { page, service } = await fixture(t);
  await page.evaluate(() => {
    const scroller = document.querySelector('.page-container')!;
    scroller.innerHTML =
      '<div style="height:600px"><div id="visible"></div></div>';
    const render = (): void => {
      const start = Math.floor(scroller.scrollTop / 60);
      document.querySelector('#visible')!.innerHTML = [start, start + 1]
        .map(
          (index) =>
            `<flow-grid-tile-container aria-label="Título repetido"><flow-image-tile><img data-media-id="virtual-${index}"></flow-image-tile></flow-grid-tile-container>`,
        )
        .join('');
    };
    scroller.addEventListener('scroll', render);
    render();
  });
  const listing = await service.assets({ projectId: firstProject, limit: 100 });
  assert.ok(listing.assets.some(({ mediaId }) => mediaId === 'virtual-0'));
  assert.ok(listing.assets.some(({ mediaId }) => mediaId === 'virtual-8'));
  assert.equal(
    new Set(listing.assets.map(({ mediaId }) => mediaId)).size,
    listing.assets.length,
  );
  const bounded = await service.assets({ projectId: firstProject, limit: 1 });
  assert.equal(bounded.assets.length, 1);
  assert.equal(bounded.reachedEnd, false);
});

test('real CDP attachment uses only its dedicated profile and disconnect leaves Chrome alive', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'flow-browser-cdp-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = browserConfig({ FLOW_BROWSER_HOME: directory });
  await mkdir(config.profile);
  const context = await chromium.launchPersistentContext(config.profile, {
    headless: true,
    args: ['--remote-debugging-port=0'],
  });
  t.after(() => context.close());
  for (
    let attempt = 0;
    attempt < 20 && !(await profileEndpoint(config.profile));
    attempt++
  )
    await delay(50);
  assert.ok(await readFile(join(config.profile, 'DevToolsActivePort'), 'utf8'));
  await context.route('https://flow.google.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await context
    .pages()[0]!
    .goto(`https://flow.google.com/project/${firstProject}`);
  const attached = new ProfileBrowser(config);
  t.after(() => attached.disconnect());
  const service = new FlowBrowserService(attached);
  assert.equal((await service.status()).projectId, firstProject);
  assert.equal(
    (await service.findImage({ projectId: firstProject, mediaId: 'image-a' }))
      .image.mediaId,
    'image-a',
  );
  const client = new Client({
    name: 'flow-browser-cdp-fixture',
    version: '1.0.0',
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/main.js', import.meta.url))],
    env: { FLOW_BROWSER_HOME: directory },
    stderr: 'pipe',
  });
  t.after(() => client.close());
  await client.connect(transport);
  const opened = await client.callTool({
    name: 'flow_browser_login',
    arguments: {},
  });
  assert.equal(opened.isError, true);
  assert.match(JSON.stringify(opened.content), /close_controlled_browser/);
  const reconnected = await client.callTool({
    name: 'flow_browser_connect',
    arguments: {},
  });
  assert.notEqual(reconnected.isError, true);
  assert.equal(
    context.pages().length,
    1,
    'Manual login reuses the existing dedicated window',
  );
  const confirmed = await client.callTool({
    name: 'flow_browser_find_image',
    arguments: { projectId: firstProject, mediaId: 'image-b' },
  });
  assert.notEqual(confirmed.isError, true);
  assert.match(JSON.stringify(confirmed.content), /image-b/);
  await context.route(
    `https://flow.google.com/project/${secondProject}**`,
    (route) => route.abort('failed'),
  );
  const failedNavigation = await client.callTool({
    name: 'flow_browser_open_project',
    arguments: { projectId: secondProject },
  });
  assert.equal(failedNavigation.isError, true);
  assert.match(
    JSON.stringify(failedNavigation.content),
    /browser_operation_failed/,
  );
  assert.doesNotMatch(
    JSON.stringify(failedNavigation.content),
    /https:|page.goto|Call log/,
  );
  await client.close();
  await attached.disconnect();
  assert.equal(await context.pages()[0]!.evaluate(() => 6 * 7), 42);
});
