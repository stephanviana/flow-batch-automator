import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { exactPrompt, composerText } from '../src/executor/prompt.js';

test('composer preserves blank lines, spaces and paragraph breaks without relying on rendered layout', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(
    '<div class="ProseMirror" contenteditable="true" style="white-space:pre-wrap"></div>',
  );
  const composer = page.locator('.ProseMirror');
  for (const text of [
    'First\n\nThird with  spaces.',
    '\nLeading and trailing\n',
    'Single\nline break',
  ]) {
    await exactPrompt(page, text);
    assert.equal(await composer.evaluate(composerText), text);
  }
  await composer.evaluate((element) => {
    element.innerHTML =
      '<p>First</p><p><br class="ProseMirror-trailingBreak"></p><p>Third<br>fourth</p>';
  });
  assert.equal(await composer.evaluate(composerText), 'First\n\nThird\nfourth');
  await composer.evaluate((element) => {
    element.addEventListener('input', () => {
      element.textContent = 'Changed by editor';
    });
  });
  await assert.rejects(exactPrompt(page, 'Original'), /não preservou/);
});
