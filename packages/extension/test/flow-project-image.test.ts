import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveSourceFrame } from '../src/flow-source-frame.js';
import { readFlowPayload } from '../src/flow-rpc-read.js';

const project = 'project';
function image(
  media: string,
  workflow: string,
  file: string,
  projectId = project,
): unknown[] {
  const detail: unknown[] = Array(14).fill(null);
  detail[13] = `https://flow-content.google/image/${file}`;
  return [
    [workflow, null, null, ['Imagem'], projectId],
    [media, null, workflow, null, null, null, [detail, null, [720, 1280]]],
  ];
}
const current = image('media', 'workflow', 'cdn');
const other = image('other', 'other-lookup', 'other-file');
test('the saved workflow, media or historical filename selects the same project image and returns its logical start frame', async () => {
  for (const pinned of ['media', 'workflow', 'cdn']) {
    const reads: string[] = [];
    const result = await resolveSourceFrame(
      async (request) => {
        reads.push(request.rpcId);
        if (request.rpcId === 'as29s')
          assert.deepEqual(request.payload, ['workflow']);
        return readFlowPayload(request, [other, current]);
      },
      project,
      pinned,
    );
    assert.deepEqual(result, { ok: true, mediaId: 'media', via: 'asset' });
    assert.deepEqual(reads, ['Zzl0ze', 'as29s']);
  }
});

test('ambiguous, missing and foreign project images stop before any asset or generation request', async () => {
  for (const listing of [
    [other],
    [current, image('another', 'another-op', 'cdn')],
    [image('media', 'workflow', 'cdn', 'foreign')],
  ]) {
    const result = await resolveSourceFrame(
      async (request) => {
        assert.equal(request.rpcId, 'Zzl0ze');
        return readFlowPayload(request, listing);
      },
      project,
      'cdn',
    );
    assert.equal(result.ok, false);
  }
});

test('a different image or a video poster in the scoped read cannot serve as the start frame', async () => {
  for (const response of [
    [other],
    [
      [
        'workflow',
        project,
        'media',
        null,
        null,
        ['https://flow-content.google/image/media'],
        null,
        [[]],
      ],
    ],
  ]) {
    const result = await resolveSourceFrame(
      async (request) =>
        readFlowPayload(
          request,
          request.rpcId === 'Zzl0ze' ? [current] : response,
        ),
      project,
      'media',
    );
    assert.equal(result.ok, false);
  }
});

test('a project image tile can resolve a saved file ID when the listing is incomplete', async () => {
  const result = await resolveSourceFrame(
    async (request) => {
      assert.equal(request.rpcId, 'Zzl0ze');
      return { ok: true, value: { sourceFound: false } };
    },
    project,
    'old-file',
    async (ids) => {
      assert.deepEqual(ids, ['old-file']);
      return ['tile-media'];
    },
  );
  assert.deepEqual(result, { ok: true, mediaId: 'tile-media', via: 'tile' });
});

test('ambiguous image tiles stop the take without choosing one from the listing', async () => {
  const result = await resolveSourceFrame(
    async (request) => {
      assert.equal(request.rpcId, 'Zzl0ze');
      return readFlowPayload(request, [current]);
    },
    project,
    'cdn',
    async () => ['tile-one', 'tile-two'],
  );
  assert.equal(result.ok, false);
});
