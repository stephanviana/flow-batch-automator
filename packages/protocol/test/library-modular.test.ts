import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryFilesSchema, instructionFileSchema } from '../src/library.js';

test('modular UTF-8 byte limits apply at each file and at the complete library boundary', () => {
  const maximum = 'é'.repeat(524288);
  assert.equal(
    libraryFilesSchema.safeParse({ 'base.md': maximum }).success,
    true,
  );
  assert.equal(
    libraryFilesSchema.safeParse({ 'base.md': maximum + 'é' }).success,
    false,
  );
  assert.equal(
    libraryFilesSchema.safeParse({ 'formatos/seller.md': maximum + 'é' })
      .success,
    false,
  );
  assert.equal(
    libraryFilesSchema.safeParse({ 'instrucoes/old.md': 'a'.repeat(262145) })
      .success,
    false,
  );
  const many = Object.fromEntries(
    Array.from({ length: 9 }, (_, index) => [`formatos/f${index}.md`, maximum]),
  );
  assert.equal(libraryFilesSchema.safeParse(many).success, false);
  for (const path of [
    'base.md',
    'formatos/seller.md',
    'biblioteca.md',
    'instrucoes/old.json',
  ])
    assert.equal(instructionFileSchema.safeParse(path).success, true);
  for (const path of [
    '../base.md',
    'formatos/../secret.md',
    '/base.md',
    'formatos/.hidden.md',
  ])
    assert.equal(instructionFileSchema.safeParse(path).success, false);
});
