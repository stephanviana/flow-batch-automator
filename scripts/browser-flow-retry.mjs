import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localClient } from './orders.mjs';

export async function authorizeFixtureRetry(browser, base, recover) {
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/orders`);
    await page
      .getByRole('button', { name: 'Ver diagnóstico', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Solicitar revisão no chat', exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Autorizar nova tentativa', exact: true })
        .count(),
      0,
    );
    const api = await localClient(base);
    const { tasks } = await api('/manage/orders/1/diagnostics');
    const task = tasks[0].task;
    await page.evaluate(() => {
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text) => {
            globalThis.revisionChatRequest = text;
          },
        },
      });
    });
    await page
      .getByRole('button', { name: 'Solicitar revisão no chat', exact: true })
      .click();
    assert.match(
      await page.evaluate(() => globalThis.revisionChatRequest),
      /Autorizo uma nova tentativa de um vídeo/,
    );
    assert.match(
      await page.evaluate(() => globalThis.revisionChatRequest),
      /execute=true e userAuthorized=true/,
    );
    const review = await api(`/manage/takes/${task.id}/review`);
    assert.equal(review.canPrepare, true);
    const content = {
      copy: 'Gancho revisado de teste.',
      videoPrompt: review.current.videoPrompt.replace(
        review.current.copy,
        'Gancho revisado de teste.',
      ),
      reason: 'Revisão sintética após recusa de política.',
    };
    const publication = {
      requestId: randomUUID(),
      expectedRevision: task.revision,
      content,
    };
    const revision = await api(
      `/manage/takes/${task.id}/revisions`,
      publication,
    );
    assert.equal(revision.approvedAt, null);
    assert.equal(
      (await api('/manage/orders/1/diagnostics')).tasks[0].task.attemptCount,
      1,
    );
    await page
      .getByRole('button', { name: 'Atualizar diagnóstico', exact: true })
      .click();
    await page
      .getByText('Versão preparada · aguarda autorização no chat', {
        exact: true,
      })
      .waitFor();
    recover(content);
    const approved = await api(`/manage/takes/${task.id}/revisions`, {
      ...publication,
      execution: { userAuthorized: true, startQueue: true },
    });
    assert.equal(approved.attemptNumber, 2);
    console.log(
      'Chrome isolado com fixtures: solicitação copiada autoriza um vídeo com a imagem existente; publicação revisada registra a autorização e processa o take na mesma operação.',
    );
  } finally {
    await page.close();
  }
}
