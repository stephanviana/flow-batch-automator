import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { installInstructions } from './test-support/instruction-package.mjs';

const directory = resolve('.cache', `instructions-browser-${randomUUID()}`),
  instructions = resolve(directory, 'instructions');
await mkdir(directory, { recursive: true });
const base = 'http://127.0.0.1:4349';
const server = spawn(process.execPath, ['packages/orchestrator/dist/main.js'], {
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '4349',
    DATABASE_PATH: resolve(directory, 'state.sqlite'),
    LIBRARY_DIR: instructions,
    LOG_LEVEL: 'silent',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '',
  browser;
server.stdout.on('data', (bytes) => {
  logs += bytes;
});
server.stderr.on('data', (bytes) => {
  logs += bytes;
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null)
      throw new Error(`Servidor sintético encerrou: ${logs}`);
    ready = await fetch(`${base}/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready);
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  await page.goto(`${base}/orders`);
  assert.equal(await page.locator('a[href="/library"]').count(), 0);
  const removed = await page.request.get(`${base}/library`);
  assert.equal(removed.status(), 404);
  const getStatus = () =>
    page.request
      .get(`${base}/manage/agent/capabilities`, {
        headers: { 'X-Flow-Management': '1' },
      })
      .then((r) => r.json());
  assert.equal((await getStatus()).library.configured, false);
  assert.deepEqual((await readdir(instructions)).sort(), [
    '.historico',
    'base.md',
    'formatos',
    'instrucoes.json',
  ]);
  const metadata = JSON.parse(
    await readFile(resolve(instructions, 'instrucoes.json'), 'utf8'),
  );
  assert.equal(metadata.current, null);
  const emptyRead = await page.request.post(`${base}/manage/library/file`, {
    headers: { 'X-Flow-Management': '1', Origin: base },
    data: {},
  });
  assert.equal((await emptyRead.json()).path, 'base.md');
  installInstructions(instructions);
  assert.equal((await getStatus()).library.configured, true);
  execFileSync(
    process.execPath,
    ['scripts/library.mjs', 'convert', instructions],
    {
      env: { ...process.env, FLOW_BATCH_HOME: resolve(directory, 'cli-state') },
      stdio: 'pipe',
    },
  );
  const converted = (await getStatus()).library;
  assert.equal(converted.format, 'document');
  assert.equal(converted.configured, true);
  assert.deepEqual(converted.files, ['biblioteca.md']);
  const documentResponse = await page.request.post(
    `${base}/manage/library/file`,
    {
      headers: { 'X-Flow-Management': '1', Origin: base },
      data: {},
    },
  );
  assert.ok(documentResponse.ok());
  const document = await documentResponse.json();
  assert.equal(document.path, 'biblioteca.md');
  assert.match(document.text, /# \[common\]/);
  const beforePreview = (await readdir(instructions)).sort();
  const preview = execFileSync(
    process.execPath,
    ['scripts/library.mjs', 'split', instructions],
    {
      env: { ...process.env, FLOW_BATCH_HOME: resolve(directory, 'cli-state') },
      encoding: 'utf8',
    },
  );
  assert.equal(JSON.parse(preview).preview, true);
  assert.deepEqual((await readdir(instructions)).sort(), beforePreview);
  const connector = await page.request.get(`${base}/agent/flow-batch-mcp.mjs`);
  assert.ok(connector.ok());
  assert.match(await connector.text(), /flow_checkout/);
  await page.screenshot({
    path: resolve(directory, 'pedidos-sem-editor.png'),
    fullPage: true,
  });
  console.log(
    `Biblioteca modular vazia, leitura padrão, compatibilidade legada, prévia de divisão e leitura HTTP, painel sem editor e download do conector validados. Evidências: ${directory}`,
  );
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await stopped;
  }
  await writeFile(resolve(directory, 'server.log'), logs);
}
