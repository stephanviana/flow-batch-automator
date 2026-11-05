import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { readinessSchema } from '@flow-batch/protocol';

test('HTTP distinguishes liveness from a real SQLite failure without leaking details', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'flow-http-'));
  const databasePath = join(directory, 'database.sqlite');
  const app = createApp(
    loadConfig({
      DATABASE_PATH: databasePath,
      LIBRARY_DIR: join(directory, 'instructions'),
      LOG_LEVEL: 'silent',
    }),
  );
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const headers = { host: '127.0.0.1:4319' };
  const ready = await app.inject({ url: '/health', headers });
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(readinessSchema.parse(ready.json()), {
    status: 'ready',
    sqlite: 'available',
  });
  const external = new DatabaseSync(databasePath);
  external.exec('DROP TABLE application_metadata');
  external.close();
  const failed = await app.inject({ url: '/health', headers });
  assert.equal(failed.statusCode, 503);
  assert.deepEqual(failed.json(), {
    status: 'unavailable',
    sqlite: 'unavailable',
  });
  assert.equal(failed.body.includes(directory), false);
  const live = await app.inject({ url: '/health/live', headers });
  assert.equal(live.statusCode, 200);
  assert.deepEqual(live.json(), { status: 'alive' });
});

test('HTTP rejects DNS rebinding and web origins, allows extension health only without CORS', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'flow-boundary-'));
  const app = createApp(
    loadConfig({
      DATABASE_PATH: join(directory, 'db.sqlite'),
      LIBRARY_DIR: join(directory, 'instructions'),
      LOG_LEVEL: 'silent',
    }),
  );
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  for (const headers of [
    { host: 'evil.example:4319' },
    { host: '127.0.0.1:4319', origin: 'https://evil.example' },
    { host: '127.0.0.1:4319', origin: 'null' },
    { host: '127.0.0.1:4319', origin: 'chrome-extension://invalid' },
  ]) {
    assert.equal(
      (await app.inject({ url: '/health', headers })).statusCode,
      403,
    );
  }
  for (const origin of [
    undefined,
    'http://localhost:4319',
    `chrome-extension://${'a'.repeat(32)}`,
  ]) {
    const headers = origin
      ? { host: '127.0.0.1:4319', origin }
      : { host: '127.0.0.1:4319' };
    const response = await app.inject({ url: '/health', headers });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    assert.equal(response.headers['x-frame-options'], 'DENY');
  }
  const page = await app.inject({
    url: '/connect',
    headers: { host: '127.0.0.1:4319' },
  });
  assert.equal(page.statusCode, 200);
  assert.match(String(page.headers['set-cookie']), /HttpOnly; SameSite=Strict/);
});
