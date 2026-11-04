import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const directory = resolve('.cache', `library-browser-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const base = 'http://127.0.0.1:4349';
const server = spawn(process.execPath, ['packages/orchestrator/dist/main.js'], {
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '4349',
    DATABASE_PATH: resolve(directory, 'state.sqlite'),
    LIBRARY_DIR: resolve(directory, 'biblioteca'),
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
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null)
      throw new Error(`Servidor sintético encerrou: ${logs}`);
    ready = await fetch(`${base}/health`)
      .then((response) => response.ok)
      .catch(() => false);
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, 'Servidor sintético indisponível');
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/library`);
  await page.locator('#files option').first().waitFor({ state: 'attached' });
  await page.locator('#files').selectOption('instrucoes/copy/pov.md');
  await page.waitForFunction(() =>
    document.querySelector('#editor').value.includes('POV'),
  );
  const original = await page.locator('#editor').inputValue();
  await page
    .locator('#editor')
    .fill(original + '\n\nRegra editorial de teste: exemplo sintético.\n');
  // An unsaved edit must never be assigned to a different selected file.
  await page.locator('#files').selectOption('instrucoes/copy/fabrica.md');
  await page.waitForFunction(
    () => document.querySelector('#files').value === 'instrucoes/copy/pov.md',
  );
  await page.locator('#save').click();
  await page.waitForFunction(() =>
    document.querySelector('#status').textContent.includes('Rascunho salvo'),
  );
  await page.locator('#message').fill('Teste de revisão no navegador');
  await page.locator('#publish').click();
  await page.waitForFunction(() =>
    document
      .querySelector('#status')
      .textContent.includes('Biblioteca publicada'),
  );
  const exportEvent = page.waitForEvent('download');
  await page.locator('#export').click();
  const exported = await exportEvent;
  const backupPath = resolve(directory, 'backup.json');
  await exported.saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.equal(backup.revisions.length, 2);
  assert.ok(
    backup.draft['instrucoes/copy/pov.md'].includes('Regra editorial de teste'),
  );
  const initial = backup.revisions.find(
    (revision) => revision.revision !== backup.current,
  );
  await page.locator('#revision').selectOption(initial.revision);
  await page.locator('#restore').click();
  await page.waitForFunction(() =>
    document
      .querySelector('#status')
      .textContent.includes('Revisão restaurada'),
  );
  assert.equal(await page.locator('#editor').inputValue(), original);
  await page.locator('#backup').setInputFiles(backupPath);
  await page.waitForFunction(() => !document.querySelector('#import').disabled);
  assert.match(
    await page.locator('#import-preview').textContent(),
    /instrucoes\/copy\/pov.md/,
  );
  const importResponse = page.waitForResponse((response) =>
    response.url().endsWith('/manage/library/import'),
  );
  await page.locator('#import').click();
  const imported = await importResponse;
  assert.ok(imported.ok(), await imported.text());
  await page.waitForFunction(() =>
    document
      .querySelector('#status')
      .textContent.includes('Biblioteca importada'),
  );
  assert.ok(
    (await page.locator('#editor').inputValue()).includes(
      'Regra editorial de teste',
    ),
  );
  const connectorEvent = page.waitForEvent('download');
  await page.locator('#download-mcp').click();
  const connector = await connectorEvent;
  assert.equal(connector.suggestedFilename(), 'flow-batch-mcp.mjs');
  await connector.saveAs(resolve(directory, 'flow-batch-mcp.mjs'));
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.screenshot({
    path: resolve(directory, 'biblioteca.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
  );
  console.log(
    `Biblioteca: edição, revisão, restauração, backup/importação e download MCP validados. Evidências: ${directory}`,
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
