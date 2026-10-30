import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { URLSearchParams } from 'node:url';
import { prepareBatch } from './browser-batches.mjs';

export async function validateFlowTake({
  browser,
  panel,
  eventually,
  stopServer,
  startServer,
  media,
}) {
  const projectId = randomUUID(),
    referenceId = randomUUID(),
    imageId = randomUUID(),
    operationId = randomUUID(),
    videoId = randomUUID();
  const referenceBytes = await readFile(
    new URL('./fixtures/reference.png', import.meta.url),
  );
  const original = {
    imagePrompt: '  {"prompt":"__CAPTCHA__ azul"}\n',
    videoPrompt: '  Movimento suave\nsem cortes. ',
    copy: ' Hook\nBody\nCTA ',
  };
  let imageCount = 0,
    videoCount = 0,
    uploadCount = 0,
    mediaCount = 0;
  const captchaTokens = new Set();
  let held, release;
  let mode = 'success';
  let expectedVideoModel = 'abra_i2v_8s';
  let expectedImageModel = 'GEM_PIX_2';
  await browser.route('https://flow.google.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.endsWith('/batchexecute')) {
      await route.fulfill({
        contentType: 'text/html',
        body: `<html lang="pt-BR"><body><script>
        globalThis.WIZ_global_data={SNlM0e:'fixture-at-token',FdrFJe:'fixture-session',cfb2h:'fixture-build'};
        globalThis.__fixtureCaptchaCounter=0;
        globalThis.grecaptcha={enterprise:{execute:async(_key,options)=>{
          if(globalThis.__fixtureCaptchaFailure)throw new Error('fixture');
          return 'fixture-captcha-'+options.action+'-'+(++globalThis.__fixtureCaptchaCounter);
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
    if (rpcId === 'maseQ') {
      uploadCount++;
      assert.equal(payload[1], referenceBytes.toString('base64'));
      assert.equal(payload[2], 'image/png');
      result = [[referenceId, projectId]];
    } else if (rpcId === 'ogiZ0b') {
      imageCount++;
      const item = payload[1][0];
      assert.equal(item[2][0][0], referenceId);
      assert.equal(item[4], 2);
      assert.equal(item[5], expectedImageModel);
      assert.equal(item[8][0][0][0], original.imagePrompt);
      assert.equal(item[7][10][0], payload[3][10][0]);
      if (mode === 'hold-image') {
        held = true;
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      result = [
        [
          `https://flow-content.google/image/${imageId}?fixture-cdn-token=image`,
        ],
      ];
    } else if (rpcId === 'eb1hJf') {
      videoCount++;
      const item = payload[0][0];
      assert.equal(item[0][2][0][0][0], original.videoPrompt);
      assert.equal(item[1], expectedVideoModel);
      assert.equal(item.length, expectedVideoModel.endsWith('_360p') ? 10 : 6);
      if (expectedVideoModel.endsWith('_360p'))
        assert.deepEqual(item.slice(6), [null, null, null, [4]]);
      assert.equal(item[2], 1);
      assert.equal(item[4][1], imageId);
      result = [null, 50, [[operationId, projectId, randomUUID(), 'BUSY']]];
    } else if (rpcId === 'jwpduf') {
      assert.equal(payload[2][0][0], operationId);
      result = [null, 50, [[operationId, projectId, randomUUID(), 'BUSY']]];
    } else if (rpcId === 'Zzl0ze') {
      assert.equal(payload[0], `projects/${projectId}`);
      result = [
        [
          operationId,
          'folder',
          null,
          ['Video', [1, 0], true, null, videoId, operationId, true],
          projectId,
        ],
      ];
    } else if (rpcId === 'as29s') {
      mediaCount++;
      assert.equal(payload[0], videoId);
      result = [
        [
          mediaCount === 1
            ? `https://flow-content.google/image/${videoId}`
            : `https://flow-content.google/video/${videoId}?fixture-cdn-token=video${mode === 'html-download' ? '&html=1' : ''}`,
        ],
      ];
    } else assert.fail(`Unexpected fixture RPC ${rpcId}`);
    const response = JSON.stringify([
      ['wrb.fr', rpcId, JSON.stringify(result)],
    ]);
    await route.fulfill({
      contentType: 'application/json',
      body: `)]}'\n\n${response.length}\n${response}\n`,
    });
  });
  const flow = await browser.newPage();
  const realTasks = panel.locator(
    '#queue-tasks > li[data-executor="google-flow"]',
  );
  const inspect = async () => {
    await panel.locator('[data-action="flow-inspect"]').click();
    await eventually(
      async () =>
        (await panel.locator('#flow-status').getAttribute('data-phase')) ===
          'ready' &&
        !(await panel.locator('[data-action="flow-inspect"]').isDisabled()),
    );
  };
  const enqueue = async (take) => {
    const count = await realTasks.count();
    await panel.locator('[name="product"]').fill('Produto fixture');
    await panel.locator('[name="video"]').fill('Vídeo fixture');
    await panel.locator('[name="take"]').fill(take);
    await panel.locator('[name="reference"]').setInputFiles({
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: referenceBytes,
    });
    for (const [name, value] of Object.entries(original))
      await panel.locator(`[name="${name}"]`).fill(value);
    // Submitting without approval cannot enqueue work or send provider requests.
    assert.equal(await panel.locator('#flow-approval').isChecked(), false);
    await panel.locator('#flow-submit').click();
    assert.equal(await realTasks.count(), count);
    await panel.locator('#flow-approval').check();
    await panel.locator('#flow-submit').click();
    await eventually(async () => (await realTasks.count()) === count + 1);
    const id = await realTasks.first().getAttribute('data-task-id');
    return panel.locator(`#queue-tasks > li[data-task-id="${id}"]`);
  };
  const review = async (row, note) => {
    await row.locator('[aria-label="Nota de revisão"]').fill(note);
    await row
      .getByRole('button', { name: 'Encerrar tentativa com falha' })
      .click();
    const id = await row.getAttribute('data-task-id');
    await eventually(
      async () =>
        (await panel
          .locator(`[data-task-id="${id}"]`)
          .getAttribute('data-state')) === 'failed',
    );
  };
  try {
    await flow.goto(`https://flow.google.com/project/${projectId}`);
    assert.equal(
      await flow.evaluate(() => typeof globalThis.__fk_hijack?.pristine),
      'function',
    );
    await inspect();
    assert.equal(
      await panel.locator('[name="videoModel"]').inputValue(),
      'omni_flash',
    );
    assert.equal(
      await panel.locator('[name="videoMode"]').inputValue(),
      'frames',
    );
    assert.equal(
      await panel.locator('[name="videoDuration"]').inputValue(),
      '8',
    );
    assert.equal(
      await panel.locator('[name="videoResolution"]').inputValue(),
      '720p',
    );
    assert.deepEqual(
      await panel
        .locator('[name="imageModel"] option')
        .evaluateAll((options) => options.map((option) => option.value)),
      ['GEM_PIX_2', 'BELUGA'],
    );
    if (!(await panel.locator('[data-action="queue-pause"]').isDisabled()))
      await panel.locator('[data-action="queue-pause"]').click();
    const batchReply = await prepareBatch(
      panel,
      eventually,
      'Lote de takes fixture',
      'existing-project',
    );
    const batch = batchReply.batches.find(
      (batch) => batch.id === batchReply.activeBatchId,
    );
    assert.equal(batch.projectId, projectId);
    const complete = await enqueue('Take completo');
    // The queue must navigate the same Flow tab back to this take's fixed project.
    await flow.goto('https://flow.google.com/');
    media.holdNextDownload();
    await panel.locator('[data-action="queue-start"]').click();
    await eventually(async () =>
      (await panel.locator('#queue-activity-title').textContent()).includes(
        'Gerando imagem',
      ),
    );
    assert.equal(
      await panel.locator('#queue-steps li[aria-current="step"]').textContent(),
      '2Imagem',
    );
    await eventually(async () =>
      (await panel.locator('#queue-activity-title').textContent()).includes(
        'vídeo',
      ),
    );
    assert.equal(
      await panel.locator('#queue-activity').getAttribute('data-busy'),
      'true',
    );
    await eventually(
      async () =>
        (await panel.locator('#queue-activity-title').textContent()) ===
        'Baixando MP4',
      60000,
    );
    assert.equal(
      await panel.locator('#queue-steps li[aria-current="step"]').textContent(),
      '4MP4',
    );
    assert.notEqual(await complete.getAttribute('data-state'), 'completed');
    media.releaseDownload();
    await eventually(
      async () => (await complete.getAttribute('data-state')) === 'completed',
      60000,
    );
    assert.equal(uploadCount, 1);
    assert.equal(imageCount, 1);
    assert.equal(videoCount, 1);
    assert.equal(flow.url(), `https://flow.google.com/project/${projectId}`);
    assert.equal(
      browser
        .pages()
        .filter((page) => page.url().startsWith('https://flow.google.com/'))
        .length,
      1,
    );
    assert.equal(
      await panel.locator('#queue-activity').getAttribute('data-tone'),
      'success',
    );
    assert.equal(
      await panel.locator('#queue-steps [data-status="done"]').count(),
      4,
    );
    assert.ok(
      (await panel.locator('#queue-activity-title').textContent()).includes(
        'MP4 disponível',
      ),
    );
    assert.ok(mediaCount >= 2);
    assert.equal(media.requests.length, 1);
    const taskId = await complete.getAttribute('data-task-id');
    const detail = (
      await panel.evaluate(
        (taskId) =>
          chrome.runtime.sendMessage({ type: 'queue-inspect', taskId }),
        taskId,
      )
    ).inspection;
    assert.deepEqual(detail.input.original, original);
    assert.equal(detail.input.flow.batchId, batch.id);
    assert.equal(detail.task.batchName, batch.name);
    assert.equal(
      detail.input.flow.reference.sha256,
      createHash('sha256').update(referenceBytes).digest('hex'),
    );
    assert.equal(detail.checkpoints.length, 5);
    assert.equal(detail.task.result.simulated, false);
    assert.equal(JSON.stringify(detail).includes('fixture-at-token'), false);
    assert.equal(JSON.stringify(detail).includes('fixture-captcha-'), false);
    assert.equal(JSON.stringify(detail).includes('fixture-cdn-token'), false);
    assert.equal(
      JSON.stringify(detail).includes(referenceBytes.toString('base64')),
      false,
    );
    const worker = browser.serviceWorkers()[0];
    const item = await worker.evaluate(
      async (id) => (await chrome.downloads.search({ id }))[0],
      detail.task.result.downloadId,
    );
    assert.equal(item.state, 'complete');
    assert.equal(item.mime, 'video/mp4');
    assert.ok(item.filename.includes('/.cache/browser-'));
    assert.ok(item.filename.endsWith(`/FlowBatch/${taskId}/take.mp4`));
    assert.deepEqual(await readFile(item.filename), media.video);
    assert.equal(
      await complete
        .getByRole('button', { name: 'Mostrar MP4 na pasta' })
        .count(),
      1,
    );

    await panel.locator('[data-action="queue-pause"]').click();
    await panel.locator('#flow-approval').check();
    await panel.locator('[name="videoModel"]').selectOption('veo_3_1_i2v_lite');
    assert.equal(await panel.locator('#flow-approval').isChecked(), false);
    assert.equal(await panel.locator('#omni-options').isHidden(), true);
    assert.equal(
      await panel.locator('[name="videoDuration"]').isDisabled(),
      true,
    );
    expectedVideoModel = 'veo_3_1_i2v_lite';
    mode = 'hold-image';
    const interrupted = await enqueue('Take interrompido');
    await panel.locator('[data-action="queue-start"]').click();
    await eventually(() => held === true);
    await stopServer();
    release();
    await startServer();
    await eventually(
      async () =>
        (await interrupted.getAttribute('data-state')) === 'uncertain',
      40000,
    );
    await delay(500);
    assert.equal(
      await panel.locator('#queue-activity').getAttribute('data-tone'),
      'warning',
    );
    assert.equal(
      await panel.locator('#queue-activity').getAttribute('data-busy'),
      'false',
    );
    assert.equal(imageCount, 2);
    assert.equal(videoCount, 1);
    assert.equal(
      await panel.locator('[data-action="queue-start"]').isDisabled(),
      true,
    );
    await review(
      interrupted,
      'Fixture revisada: envio de imagem interrompido; não gerar novamente.',
    );

    mode = 'success';
    await flow.evaluate(() => {
      globalThis.__fixtureCaptchaFailure = true;
    });
    const preflight = await enqueue('Verificação indisponível');
    await panel.locator('[data-action="queue-start"]').click();
    await eventually(
      async () => (await preflight.getAttribute('data-state')) === 'failed',
    );
    assert.equal(uploadCount, 2);
    assert.equal(imageCount, 2);
    assert.equal(videoCount, 1);
    assert.equal(await preflight.getAttribute('data-attempt-count'), '1');
    await flow.evaluate(() => {
      globalThis.__fixtureCaptchaFailure = false;
    });

    await panel.locator('[name="videoModel"]').selectOption('omni_flash');
    await panel.locator('[name="videoDuration"]').selectOption('4');
    await panel.locator('[name="videoResolution"]').selectOption('360p');
    await panel.locator('[name="imageModel"]').selectOption('BELUGA');
    assert.equal(await panel.locator('#omni-options').isHidden(), false);
    expectedVideoModel = 'abra_i2v_4s_360p';
    expectedImageModel = 'BELUGA';
    mode = 'html-download';
    const invalidDownload = await enqueue('Download inválido');
    await eventually(
      async () =>
        (await invalidDownload.getAttribute('data-state')) === 'uncertain',
      60000,
    );
    assert.ok(
      (await invalidDownload.textContent()).includes('arquivo de vídeo válido'),
    );
    await review(
      invalidDownload,
      'Fixture revisada: resposta de download era HTML, não um vídeo.',
    );
    await inspect();
    console.log(
      'Omni 1.1 Flash Frames pipeline (8s/720p and 4s/360p, Nano Banana Pro/2.1) against local fixtures: original reference/prompts, explicit approval, fresh page-only CAPTCHA tokens, one image and video, operation/media correlation, actual Chrome MP4 download and byte comparison, restart without resubmission, CAPTCHA failure and HTML download rejection passed. No live Google Flow generation.',
    );
  } finally {
    media.releaseDownload();
    release?.();
    await flow.close();
    await browser.unroute('https://flow.google.com/**');
  }
}
