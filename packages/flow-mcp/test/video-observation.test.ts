import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { Page, Response } from 'playwright-core';
import {
  envelope,
  OPERATION,
  PROJECT,
  VIDEO,
} from '../browser/generation-fixture.js';
import { observeVideo } from '../src/executor/video.js';

function status(
  body: Promise<string>,
  origin = 'https://flow.google.com',
): Pick<Response, 'url' | 'ok' | 'text'> {
  return {
    url: (): string =>
      `${origin}/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=jwpduf`,
    ok: (): boolean => true,
    text: (): Promise<string> => body,
  };
}

test('video monitoring collects responses before acceptance and correlates the operation', async () => {
  const page = new EventEmitter();
  const signal = new AbortController().signal;
  const otherOperation = envelope('jwpduf').replace(OPERATION, randomUUID());
  const otherProject = envelope('jwpduf').replace(PROJECT, randomUUID());
  const result = await observeVideo(
    page as unknown as Page,
    PROJECT,
    signal,
    async () => {
      page.emit('response', status(new Promise<string>(() => {})));
      page.emit(
        'response',
        status(Promise.resolve(envelope('jwpduf')), 'https://example.test'),
      );
      page.emit('response', status(Promise.resolve(otherOperation)));
      page.emit('response', status(Promise.resolve(otherProject)));
      page.emit('response', status(Promise.resolve(envelope('jwpduf'))));
      return OPERATION;
    },
  );
  assert.deepEqual(result, {
    operationId: OPERATION,
    video: {
      mediaId: VIDEO,
      url: 'https://flow-content.google/video/video-file',
    },
  });
  assert.equal(page.listenerCount('response'), 0);
  assert.equal(page.listenerCount('close'), 0);
});

test('a failed submission or closed tab detaches video state observation', async () => {
  const page = new EventEmitter();
  const signal = new AbortController().signal;
  await assert.rejects(
    observeVideo(page as unknown as Page, PROJECT, signal, async () => {
      throw new Error('Synthetic acceptance failure');
    }),
    /Synthetic acceptance failure/,
  );
  assert.equal(page.listenerCount('response'), 0);
  await assert.rejects(
    observeVideo(page as unknown as Page, PROJECT, signal, async () => {
      setImmediate(() => page.emit('close'));
      return OPERATION;
    }),
    { code: 'flow_video_unconfirmed' },
  );
  assert.equal(page.listenerCount('response'), 0);
  assert.equal(page.listenerCount('close'), 0);
});
