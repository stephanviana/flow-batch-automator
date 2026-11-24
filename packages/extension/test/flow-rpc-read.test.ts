import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFlowPayload } from '../src/flow-rpc-read.js';

const projectId = 'project-fixture';
const workflowId = 'workflow-fixture';
const mediaId = 'media-fixture';
const videoUrl = 'https://flow-content.google/video/file-fixture?fixture=1';

function generation(
  status: number,
  workflow = workflowId,
  media = mediaId,
  project = projectId,
): unknown[] {
  const details: unknown[] = Array(14).fill(null);
  details[8] = [status];
  details[10] = 'https://flow-content.google/image/poster-fixture';
  const video: unknown[] = Array(13).fill(null);
  video[8] = status === 3 ? videoUrl : null;
  video[12] = 'abra_i2v_8s';
  return [workflow, project, media, null, null, details, null, [video]];
}
function metadata(media: string, workflow: string): unknown[] {
  return [
    media,
    null,
    null,
    ['Título livre', [1, 0], null, null, workflow, 'X'],
    projectId,
  ];
}

test('video submit distinguishes the media header from its workflow record, with a null marker', () => {
  const payload = [
    null,
    50,
    [metadata(mediaId, workflowId)],
    [[generation(6)]],
  ];
  assert.deepEqual(
    readFlowPayload({ rpcId: 'eb1hJf', projectId, payload: [] }, payload),
    {
      ok: true,
      value: { operationId: workflowId, mediaId, status: '', outcomeCode: 6 },
    },
  );
});

test('historical media IDs and current workflow IDs resolve to the same video without treating a missing boolean as absence', () => {
  const source = [
    'image-workflow',
    projectId,
    'image-media',
    null,
    null,
    [],
    null,
  ];
  const payload = [
    [metadata(mediaId, workflowId), metadata('image-media', 'image-workflow')],
    [[source], [generation(3)]],
  ];
  for (const operationId of [mediaId.toUpperCase(), workflowId]) {
    assert.deepEqual(
      readFlowPayload(
        {
          rpcId: 'Zzl0ze',
          projectId,
          operationId,
          sourceMediaId: 'IMAGE-MEDIA',
          payload: [],
        },
        payload,
      ),
      {
        ok: true,
        value: {
          operationId: workflowId,
          mediaId,
          status: '',
          outcomeCode: 3,
          videoUrl,
          sourceFound: true,
          sourceOperationId: 'image-workflow',
        },
      },
    );
  }
});

test('metadata-only listings preserve distinct IDs while leaving readiness to the scoped result read', () => {
  assert.deepEqual(
    readFlowPayload(
      { rpcId: 'Zzl0ze', projectId, operationId: mediaId, payload: [] },
      [[metadata(mediaId, workflowId)]],
    ),
    {
      ok: true,
      value: { operationId: workflowId, mediaId },
    },
  );
});

test('a completed result selects only this workflow clip and excludes posters and other clips', () => {
  const other = generation(3, 'other-workflow', 'other-media');
  const payload = [[generation(3)], [other]];
  assert.deepEqual(
    readFlowPayload(
      {
        rpcId: 'as29s',
        projectId,
        operationId: workflowId,
        mediaId,
        payload: [workflowId],
      },
      payload,
    ),
    {
      ok: true,
      value: {
        mediaId,
        operationId: workflowId,
        status: '',
        outcomeCode: 3,
        videoUrl,
      },
    },
  );
});

test('another workflow or another project cannot supply a URL when the requested clip is missing', () => {
  for (const payload of [
    [generation(3, 'other-workflow')],
    [generation(3, workflowId, mediaId, 'other-project')],
  ]) {
    assert.deepEqual(
      readFlowPayload(
        {
          rpcId: 'as29s',
          projectId,
          operationId: workflowId,
          mediaId,
          payload: [workflowId],
        },
        payload,
      ),
      {
        ok: true,
        value: { mediaId, videoUrl: null },
      },
    );
  }
});

test('generated images preserve the logical media ID when the CDN filename is different', () => {
  const details: unknown[] = Array(14).fill(null);
  details[13] =
    'https://flow-content.google/image/different-cdn-file?fixture=1';
  const image = [
    'image-media',
    null,
    'image-workflow',
    null,
    null,
    null,
    [details, null, [768, 1376]],
  ];
  const payload = [[metadata('image-workflow', 'unused')], [image]];
  assert.deepEqual(
    readFlowPayload({ rpcId: 'ogiZ0b', projectId, payload: [] }, payload),
    {
      ok: true,
      value: { mediaId: 'image-media' },
    },
  );
});

test('pending records carry their numeric state without being reported as a ready video', () => {
  for (const code of [2, 6]) {
    const reply = readFlowPayload(
      {
        rpcId: 'as29s',
        projectId,
        operationId: workflowId,
        payload: [workflowId],
      },
      [generation(code)],
    );
    assert.deepEqual(reply, {
      ok: true,
      value: {
        operationId: workflowId,
        mediaId,
        status: '',
        outcomeCode: code,
        videoUrl: null,
      },
    });
  }
});

test('a missing workflow report stays diagnostic and cannot become a downloadable video', () => {
  const detail: unknown[] = Array(9).fill(null);
  detail[8] = [4, [null, 'Media not found.']];
  const result = readFlowPayload(
    {
      rpcId: 'as29s',
      projectId,
      operationId: workflowId,
      payload: [workflowId],
    },
    [[workflowId, null, null, null, null, detail]],
  );
  assert.deepEqual(result, {
    ok: true,
    value: {
      mediaId: null,
      operationId: workflowId,
      status: '',
      outcomeCode: 4,
      complaint: 'media_not_found',
      videoUrl: null,
    },
  });
});

test('an image-shaped reply from another project cannot fall back to its CDN filename', () => {
  const details: unknown[] = Array(14).fill(null);
  details[13] = 'https://flow-content.google/image/foreign-file';
  const image = [
    'foreign-media',
    null,
    'foreign-workflow',
    null,
    null,
    null,
    [details, null, [768, 1376]],
  ];
  const foreign = [
    'foreign-workflow',
    null,
    null,
    ['Imagem'],
    'foreign-project',
  ];
  const result = readFlowPayload({ rpcId: 'ogiZ0b', projectId, payload: [] }, [
    [foreign],
    [image],
  ]);
  assert.equal(result.ok, false);
});

test('a video poster cannot pass the direct source-image lookup', () => {
  const result = readFlowPayload(
    {
      rpcId: 'as29s',
      projectId,
      operationId: workflowId,
      mediaKind: 'image',
      payload: [workflowId],
    },
    [generation(3)],
  );
  assert.deepEqual(result, {
    ok: true,
    value: { mediaId: null, imageAvailable: false },
  });
});

test('a confirmed safety rejection survives submission and status decoding without exposing raw error details', () => {
  const detail: unknown[] = Array(9).fill(null);
  detail[8] = [
    4,
    [null, 'PUBLIC_ERROR_UNSAFE_GENERATION'],
    ['private diagnostic'],
  ];
  const record = [
    workflowId,
    projectId,
    mediaId,
    null,
    null,
    detail,
    null,
    [[]],
  ];
  for (const rpcId of ['eb1hJf', 'jwpduf', 'as29s'] as const) {
    const result = readFlowPayload(
      { rpcId, projectId, operationId: workflowId, payload: [] },
      [null, 50, [record]],
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.outcomeCode, 4);
      assert.equal(result.value.complaint, 'unsafe_generation');
    }
    assert.equal(JSON.stringify(result).includes('private diagnostic'), false);
  }
});
