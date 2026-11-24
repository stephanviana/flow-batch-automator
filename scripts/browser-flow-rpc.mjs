import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { URLSearchParams } from 'node:url';
import {
  flowVideoRecord,
  flowImageReply,
  flowMediaMetadata,
} from './browser-flow-rpc-fixtures.mjs';

export async function createFlowRpcFixture(
  browser,
  videoModel,
  retryScenario,
  referenceBytes,
  historicalFrame,
) {
  let failFirstAttempt = retryScenario;
  const { promise: firstFailure, resolve: reportFailure } =
    Promise.withResolvers();
  let projectId = randomUUID();
  let imageId = randomUUID();
  let operationId = randomUUID();
  let videoId = randomUUID();
  let imageWorkflowId = randomUUID();
  const referenceId = randomUUID(),
    imageFileId = randomUUID(),
    videoFileId = randomUUID();
  let expectedTasks = [];
  let imageCount = 0,
    videoCount = 0,
    videoRequests = 0,
    refusedProjectReads = 0,
    refusedLinkReads = 0,
    uploadCount = 0,
    mediaCount = 0;
  const captchaTokens = new Set();
  let mode = 'success';
  const expectedVideoModel = videoModel;
  let expectedImageModel = 'GEM_PIX_2';
  let projectsCreated = 0;
  let projectLoads = 0;
  let loadsBeforeRetry;
  await browser.route('https://flow.google.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.endsWith('/batchexecute')) {
      if (
        request.isNavigationRequest() &&
        url.pathname === `/project/${projectId}`
      )
        projectLoads++;
      await route.fulfill({
        contentType: 'text/html',
        body: `<html lang="pt-BR"><body><script>
        globalThis.WIZ_global_data={SNlM0e:'fixture-at-token',FdrFJe:'fixture-session',cfb2h:'fixture-build'};
        globalThis.__fixtureCaptchaCounter=0;
        globalThis.grecaptcha={enterprise:{execute:async(_key,options)=>{
          if(globalThis.__fixtureCaptchaFailure)throw new Error('fixture');
          return 'fixture-captcha-'+options.action+'-'+${JSON.stringify(randomUUID())}+'-'+(++globalThis.__fixtureCaptchaCounter);
        }}};
        const original=globalThis.grecaptcha.enterprise.execute;
        globalThis.grecaptcha.enterprise.execute=(key,options)=>original(key,Object.assign({},options,{action:'extension_hijack_detected'}));
      </script>Flow fixture</body></html>`,
      });
      return;
    }
    const rpcId = url.searchParams.get('rpcids');
    const body = new URLSearchParams(request.postData());
    assert.equal(body.get('at'), 'fixture-at-token');
    const envelope = JSON.parse(body.get('f.req'));
    assert.equal(envelope[0][0][0], rpcId);
    const payload = JSON.parse(envelope[0][0][1]);
    if (['maseQ', 'ogiZ0b', 'eb1hJf'].includes(rpcId)) {
      const context =
        rpcId === 'maseQ'
          ? payload[0]
          : rpcId === 'ogiZ0b'
            ? payload[3]
            : payload[1];
      assert.equal(context[5], projectId);
      const token = context[10][0];
      const action =
        rpcId === 'eb1hJf' ? 'VIDEO_GENERATION' : 'IMAGE_GENERATION';
      assert.ok(token.startsWith(`fixture-captcha-${action}-`));
      assert.equal(captchaTokens.has(token), false);
      captchaTokens.add(token);
    }
    let result;
    if (rpcId === 'jHPbke') {
      projectId = randomUUID();
      projectsCreated++;
      result = [projectId, [payload[1][1][0]]];
    } else if (rpcId === 'maseQ') {
      uploadCount++;
      assert.equal(payload[1], referenceBytes.toString('base64'));
      assert.equal(payload[2], 'image/png');
      result = [[referenceId, projectId]];
    } else if (rpcId === 'ogiZ0b') {
      imageCount++;
      imageId = randomUUID();
      imageWorkflowId = randomUUID();
      const item = payload[1][0];
      assert.equal(item[2][0][0], referenceId);
      assert.equal(item[4], 2);
      assert.equal(item[5], expectedImageModel);
      assert.equal(
        item[8][0][0][0],
        expectedTasks[videoCount].original.imagePrompt,
      );
      assert.equal(item[7][10][0], payload[3][10][0]);
      result = [
        [
          `https://flow-content.google/image/${historicalFrame ? imageFileId : imageId}?fixture-cdn-token=image`,
        ],
      ];
      if (retryScenario)
        result = flowImageReply(
          projectId,
          imageId,
          imageWorkflowId,
          imageFileId,
        );
    } else if (rpcId === 'eb1hJf') {
      if (loadsBeforeRetry !== undefined && videoCount === 0)
        assert.equal(
          projectLoads,
          loadsBeforeRetry + 1,
          'Retry reloads the same project before submitting the video',
        );
      operationId = randomUUID();
      videoId = randomUUID();
      videoRequests++;
      const item = payload[0][0];
      assert.equal(
        item[0][2][0][0][0],
        expectedTasks[videoCount].original.videoPrompt,
      );
      assert.equal(item[1], expectedVideoModel);
      assert.equal(item.length, expectedVideoModel.endsWith('_360p') ? 10 : 6);
      if (expectedVideoModel.endsWith('_360p'))
        assert.deepEqual(item.slice(6), [null, null, null, [4]]);
      assert.equal(item[2], 1);
      assert.equal(
        item[4][1],
        historicalFrame && !expectedTasks[videoCount].reuseImageFrom
          ? imageFileId
          : imageId,
      );
      if (!failFirstAttempt) videoCount++;
      if (historicalFrame && videoCount === 2) {
        await request.frame().evaluate(
          ({ media, file }) => {
            const tile = document.createElement('flow-image-tile');
            const image = document.createElement('img');
            image.dataset.mediaId = media;
            image.src = `https://flow-content.google/image/${file}`;
            tile.append(image);
            document.body.append(tile);
          },
          { media: imageId, file: imageFileId },
        );
      }
      result = [null, 50, [[operationId, projectId, randomUUID(), 'BUSY']]];
      if (retryScenario)
        result = [
          null,
          50,
          [flowMediaMetadata(projectId, videoId, operationId)],
          [[flowVideoRecord(projectId, videoId, operationId)]],
        ];
    } else if (rpcId === 'jwpduf') {
      assert.equal(payload[2][0][0], operationId);
      if (failFirstAttempt) {
        await firstFailure;
        const rejected = flowVideoRecord(projectId, videoId, operationId);
        rejected[5][8] = [4, [null, 'PUBLIC_ERROR_UNSAFE_GENERATION']];
        result = [null, 50, [[rejected]]];
      } else if (retryScenario) {
        result = [
          null,
          50,
          [[flowVideoRecord(projectId, videoId, operationId)]],
        ];
      } else {
        result = [null, 50, [[operationId, projectId, randomUUID(), 'BUSY']]];
      }
    } else if (rpcId === 'Zzl0ze') {
      assert.equal(payload[0], `projects/${projectId}`);
      if (retryScenario && videoCount === 3 && refusedProjectReads === 0) {
        refusedProjectReads++;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify([['wrb.fr', rpcId, null]]),
        });
        return;
      }
      result = [
        [
          operationId,
          'folder',
          null,
          ['Imagem de origem', [1, 0], false, null, imageId, operationId, true],
          projectId,
        ],
        [
          operationId,
          'folder',
          null,
          [
            'Título livre do vídeo',
            [1, 0],
            true,
            null,
            videoId,
            operationId,
            true,
          ],
          projectId,
        ],
      ];
      if (failFirstAttempt) result = result.slice(0, 1);
      if (retryScenario)
        result = [
          [
            flowMediaMetadata(projectId, imageId, imageWorkflowId),
            ...(!failFirstAttempt
              ? [flowMediaMetadata(projectId, videoId, operationId)]
              : []),
          ],
          [
            [imageWorkflowId, projectId, imageId, null, null, [], null],
            ...(!failFirstAttempt
              ? [flowVideoRecord(projectId, videoId, operationId)]
              : []),
          ],
        ];
      if (historicalFrame && videoCount < 2)
        result.push(
          flowImageReply(projectId, imageId, imageWorkflowId, imageFileId),
        );
    } else if (rpcId === 'as29s') {
      if (
        (retryScenario || historicalFrame) &&
        payload[0] === imageWorkflowId
      ) {
        result = flowImageReply(
          projectId,
          imageId,
          imageWorkflowId,
          imageFileId,
        );
      } else if (!retryScenario && !historicalFrame && payload[0] === imageId) {
        result = [[`https://flow-content.google/image/${imageId}`]];
      } else {
        if (failFirstAttempt) {
          await route.fulfill({
            status: 403,
            body: 'Fixture result read unavailable',
          });
          return;
        }
        mediaCount++;
        assert.equal(payload[0], retryScenario ? operationId : videoId);
        if (retryScenario && videoCount === 3 && refusedLinkReads === 0) {
          refusedLinkReads++;
          await route.fulfill({
            status: 503,
            body: 'Fixture download link temporarily unavailable',
          });
          return;
        }
        result = [
          [
            mediaCount === 1
              ? `https://flow-content.google/image/${videoId}`
              : `https://flow-content.google/video/${videoFileId}?fixture-cdn-token=video${mode === 'html-download' ? '&html=1' : ''}`,
          ],
        ];
        if (retryScenario)
          result = flowVideoRecord(
            projectId,
            videoId,
            operationId,
            mediaCount === 1
              ? null
              : `https://flow-content.google/video/${videoFileId}?fixture-cdn-token=video`,
          );
      }
    } else assert.fail(`Unexpected fixture RPC ${rpcId}`);
    const response = JSON.stringify([
      ['wrb.fr', rpcId, JSON.stringify(result)],
    ]);
    await route.fulfill({
      contentType: 'application/json',
      body: `)]}'\n\n${response.length}\n${response}\n`,
    });
  });
  return {
    get projectId() {
      return projectId;
    },
    get imageCount() {
      return imageCount;
    },
    get videoCount() {
      return videoCount;
    },
    get videoRequests() {
      return videoRequests;
    },
    get projectsCreated() {
      return projectsCreated;
    },
    get projectLoads() {
      return projectLoads;
    },
    get loadsBeforeRetry() {
      return loadsBeforeRetry;
    },
    get uploadCount() {
      return uploadCount;
    },
    get refusedProjectReads() {
      return refusedProjectReads;
    },
    get refusedLinkReads() {
      return refusedLinkReads;
    },
    get expectedTasks() {
      return expectedTasks;
    },
    set expectedTasks(tasks) {
      expectedTasks = tasks;
    },
    captureRetryReload() {
      loadsBeforeRetry = projectLoads;
    },
    reportFailure,
    recover() {
      failFirstAttempt = false;
    },
  };
}
