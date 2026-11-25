import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, webcrypto } from 'node:crypto';
import { test } from 'node:test';
import { executorIdentity } from '../src/executor/identity.js';
import { AttemptReceipts } from '../src/executor/receipts.js';
import { ExecutorControl } from '../src/executor/control.js';
import { decodeEnvelope } from '../src/executor/response.js';
import { ExecutionError } from '../src/executor/errors.js';
import { BrowserTakeExecutor } from '../src/executor/take.js';
import { reserveBrowser } from '../src/browser-lease.js';
import { flowExecuteSchema } from '@flow-batch/protocol';
import type { ProfileBrowser } from '../src/browser.js';

test('browser lease excludes concurrent navigation and survives until explicit release', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'flow-browser-reservation-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const release = await reserveBrowser(home);
  await assert.rejects(reserveBrowser(home), /reservado/);
  const retained = await readFile(join(home, 'browser-operation.lock'), 'utf8');
  assert.equal(JSON.parse(retained).pid, process.pid);
  await release();
  const nextRelease = await reserveBrowser(home);
  await nextRelease();
  assert.deepEqual(await readdir(home), []);
});

test('executor identity is persistent, concurrent-safe and loaded without exportable signing key', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'flow-executor-key-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const [first, second] = await Promise.all([
    executorIdentity(home),
    executorIdentity(home),
  ]);
  assert.deepEqual(first.publicKey, second.publicKey);
  assert.equal(first.privateKey.extractable, false);
  const signature = await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    first.privateKey,
    new Uint8Array([1, 2, 3]),
  );
  const publicKey = await webcrypto.subtle.importKey(
    'jwk',
    second.publicKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  assert.equal(
    await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signature,
      new Uint8Array([1, 2, 3]),
    ),
    true,
  );
  assert.deepEqual(await readdir(home), ['executor-identity.json']);
  if (process.platform !== 'win32')
    assert.equal(
      (await stat(join(home, 'executor-identity.json'))).mode & 0o777,
      0o600,
    );
});

test('attempt receipt refuses repeats while keeping the previous receipt unchanged', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'flow-executor-receipt-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const receipts = new AttemptReceipts(home);
  const id = randomUUID();
  await receipts.record(id);
  const previous = await readFile(join(home, 'attempts', `${id}.json`), 'utf8');
  await assert.rejects(receipts.record(id), /já foi recebida/);
  assert.equal(
    await readFile(join(home, 'attempts', `${id}.json`), 'utf8'),
    previous,
  );
});

test('read-only executor status does not create identity or pairing files', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'flow-executor-status-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const control = new ExecutorControl({
    home,
    profile: join(home, 'chrome-profile'),
    executable: undefined,
  });
  assert.deepEqual(await control.status(), {
    clientId: null,
    authorized: false,
    connected: false,
    needsPairing: true,
  });
  await assert.rejects(control.start(), /confirme o código/);
  assert.deepEqual(await readdir(home), []);
});

test('UI response observation accepts only the matching RPC and distinguishes confirmed refusal', () => {
  const envelope = (entry: unknown): string =>
    `)]}'\n${JSON.stringify([entry])}`;
  assert.deepEqual(
    decodeEnvelope(
      envelope(['wrb.fr', 'maseQ', JSON.stringify([['reference-id']])]),
      'maseQ',
    ),
    [['reference-id']],
  );
  assert.throws(
    () => decodeEnvelope(envelope(['wrb.fr', 'other', '[]']), 'maseQ'),
    /não confirmou/,
  );
  assert.throws(
    () =>
      decodeEnvelope(
        envelope([
          'wrb.fr',
          'ogiZ0b',
          null,
          null,
          null,
          [4, 'PUBLIC_ERROR_UNSAFE_GENERATION'],
        ]),
        'ogiZ0b',
      ),
    (error: unknown) =>
      error instanceof ExecutionError &&
      error.confirmedFailure &&
      !error.notSubmitted,
  );
});

test('pre-send playwright errors report sanitized diagnostics instead of hiding cause', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'flow-executor-diag-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const browser = {
    reserve: async () => async (): Promise<void> => {},
    page: async () => {
      throw new Error(
        'strict mode violation at https://flow.google.com/project/123?token=secret\nsecond line',
      );
    },
  } as unknown as ProfileBrowser;
  const executor = new BrowserTakeExecutor(browser, home);
  const events: unknown[] = [];
  await executor.run(
    flowExecuteSchema.parse({
      type: 'flow-execute',
      taskId: randomUUID(),
      attemptId: randomUUID(),
      attemptNumber: 1,
      original: { imagePrompt: 'img', videoPrompt: 'vid', copy: 'copy' },
      flow: {
        projectId: randomUUID(),
        driver: 'browser-ui',
        seed: null,
        maxVideoCredits: 25,
        imageModel: 'GEM_PIX_2',
        videoModel: 'abra_i2v_8s',
        aspect: '9:16',
        reference: {
          assetId: randomUUID(),
          name: 'ref.png',
          mime: 'image/png',
          bytes: 10,
          sha256: 'a'.repeat(64),
        },
        output: {
          root: 'Flow',
          directory: 'Videos/p--f--1',
          filename: '01-Gancho.mp4',
        },
        approval: {
          approvedAt: Date.now(),
          imageGenerations: 1,
          videoGenerations: 1,
        },
      },
    }),
    new AbortController().signal,
    (event) => events.push(event),
  );
  const last = events.at(-1) as {
    state: string;
    error: { code: string; message: string; notSubmitted: boolean };
  };
  assert.equal(last.state, 'uncertain');
  assert.equal(last.error.code, 'browser_execution_unknown');
  assert.equal(last.error.notSubmitted, false);
  assert.match(last.error.message, /strict mode violation at \[url\]/);
  assert.doesNotMatch(last.error.message, /token=secret/);
});
