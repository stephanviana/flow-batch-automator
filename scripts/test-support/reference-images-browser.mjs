import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';

export async function selectedFiles(picker) {
  return picker.evaluate((input) => [...input.files].map((file) => file.name));
}
export async function verifyReferencePicker(page) {
  const reference = page.getByLabel('Imagens de referência para o Flow');
  assert.equal(await reference.getAttribute('type'), 'file');
  assert.equal(await reference.evaluate((input) => input.required), true);
  assert.equal(await reference.evaluate((input) => input.multiple), true);
  assert.equal(
    await reference.evaluate((input) => input.checkValidity()),
    false,
  );
  await reference.setInputFiles({
    name: 'replacement.png',
    mimeType: 'image/png',
    buffer: await readFile('scripts/fixtures/reference.png'),
  });
  assert.deepEqual(await selectedFiles(reference), ['replacement.png']);
  await page
    .getByRole('button', {
      name: 'Remover imagem de referência: replacement.png',
      exact: true,
    })
    .click();
  await reference.setInputFiles('scripts/fixtures/reference.png');
  assert.deepEqual(await selectedFiles(reference), ['reference.png']);
  const preview = page.getByRole('img', { name: 'Referência: reference.png' });
  await preview.evaluate((image) => image.decode());
  assert.ok(await preview.evaluate((image) => image.naturalWidth > 0));
  assert.equal(await page.locator('.reference-selection li').count(), 1);
  await page
    .getByRole('button', { name: 'Remover imagem de referência' })
    .click();
  assert.deepEqual(await selectedFiles(reference), []);
  assert.equal(
    await reference.evaluate((input) => input.checkValidity()),
    false,
  );
  assert.equal(await page.locator('.reference-selection img').count(), 0);
  await reference.setInputFiles('scripts/fixtures/reference.png');
}
export async function verifyMultipleReferences(page) {
  const picker = page.getByLabel('Imagens de referência para o Flow');
  const secondImage = await page
    .locator('.brand-mark')
    .screenshot({ type: 'png' });
  await picker.setInputFiles({
    name: 'another-view.png',
    mimeType: 'image/png',
    buffer: secondImage,
  });
  assert.deepEqual(await selectedFiles(picker), [
    'reference.png',
    'another-view.png',
  ]);
  assert.equal(
    await page
      .getByRole('radio', { name: 'Usar reference.png no Flow', exact: true })
      .isChecked(),
    true,
  );
  const primary = page.getByRole('radio', {
    name: 'Usar another-view.png no Flow',
    exact: true,
  });
  await primary.check();
  await picker.setInputFiles([
    { name: 'third.png', mimeType: 'image/png', buffer: secondImage },
    { name: 'fourth.png', mimeType: 'image/png', buffer: secondImage },
  ]);
  assert.deepEqual(await selectedFiles(picker), [
    'reference.png',
    'another-view.png',
    'third.png',
    'fourth.png',
  ]);
  assert.equal(await primary.isChecked(), true);
  for (const name of ['third.png', 'fourth.png'])
    await page
      .getByRole('button', {
        name: `Remover imagem de referência: ${name}`,
        exact: true,
      })
      .click();
  await picker.dispatchEvent('cancel');
  assert.deepEqual(await selectedFiles(picker), [
    'reference.png',
    'another-view.png',
  ]);
  assert.equal(await primary.isChecked(), true);
  await page
    .getByRole('button', {
      name: 'Remover imagem de referência: another-view.png',
      exact: true,
    })
    .click();
  assert.equal(
    await page
      .getByRole('radio', { name: 'Usar reference.png no Flow', exact: true })
      .isChecked(),
    true,
  );
  await picker.setInputFiles({
    name: 'another-view.png',
    mimeType: 'image/png',
    buffer: secondImage,
  });
  await primary.check();
  const images = page.locator('.reference-selection img');
  assert.equal(await images.count(), 2);
  await images.evaluateAll((images) =>
    Promise.all(images.map((image) => image.decode())),
  );
  return secondImage;
}

export async function verifyReferenceLimits(page) {
  const picker = page.getByLabel('Imagens de referência para o Flow');
  const image = await readFile('scripts/fixtures/reference.png');
  let uploads = 0;
  const track = (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/manage/materials'
    )
      uploads++;
  };
  page.on('request', track);
  try {
    const extra = Array.from(
      { length: 29 },
      (_, index) => `extra-${index}.png`,
    );
    await picker.setInputFiles(
      extra.map((name) => ({ name, mimeType: 'image/png', buffer: image })),
    );
    await page
      .getByRole('button', { name: 'Salvar pedido', exact: true })
      .click();
    await page
      .getByText('Use até 30 materiais por produto.', { exact: true })
      .waitFor();
    for (const name of extra)
      await page
        .getByRole('button', {
          name: `Remover imagem de referência: ${name}`,
          exact: true,
        })
        .click();
    await picker.setInputFiles({
      name: 'oversized.png',
      mimeType: 'image/png',
      buffer: Buffer.concat([
        image,
        Buffer.alloc(8 * 1024 * 1024 + 1 - image.length),
      ]),
    });
    await page
      .getByRole('button', { name: 'Salvar pedido', exact: true })
      .click();
    await page
      .getByText('oversized.png: use até 8 MB.', { exact: true })
      .waitFor();
    await page
      .getByRole('button', {
        name: 'Remover imagem de referência: oversized.png',
        exact: true,
      })
      .click();
    assert.equal(uploads, 0);
    assert.deepEqual(await selectedFiles(picker), [
      'reference.png',
      'another-view.png',
    ]);
    await page.locator('#status').evaluate((node) => {
      node.textContent = '';
    });
  } finally {
    page.off('request', track);
  }
}
