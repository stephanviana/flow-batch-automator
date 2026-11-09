import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryStore } from '../src/library/store.js';
import { instructions } from './instruction-fixture.js';

function folder(t: { after(callback: () => void): void }): string {
  const path = mkdtempSync(join(tmpdir(), 'flow-metadata-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
test('legacy metadata is renamed byte-for-byte and all original capture links still resolve', (t) => {
  const root = folder(t);
  instructions.installInstructions(root);
  const store = new LibraryStore(root);
  const capture = store.capture();
  const canonical = join(root, 'instrucoes.json');
  const bytes = readFileSync(canonical);
  renameSync(canonical, join(root, 'biblioteca.json'));
  const reopened = new LibraryStore(root);
  assert.deepEqual(readFileSync(canonical), bytes);
  assert.deepEqual(reopened.current(), capture);
  assert.equal(readdirSync(root).includes('biblioteca.json'), false);
  assert.equal(
    readdirSync(root).some(
      (name) => name.includes('backup') || name === '.rascunhos',
    ),
    false,
  );
});
test('duplicate equivalent metadata is cleaned up while conflicts and invalid files never replace identity', (t) => {
  const root = folder(t);
  const store = new LibraryStore(root);
  const canonical = join(root, 'instrucoes.json');
  const legacy = join(root, 'biblioteca.json');
  const original = readFileSync(canonical, 'utf8');
  const metadata = JSON.parse(original) as {
    libraryId: string;
    current: string | null;
    version: number;
  };
  writeFileSync(
    legacy,
    JSON.stringify({
      current: metadata.current,
      libraryId: metadata.libraryId,
      version: 1,
    }),
  );
  assert.equal(
    new LibraryStore(root).status().libraryId,
    store.status().libraryId,
  );
  assert.deepEqual(readFileSync(canonical, 'utf8'), original);
  for (const body of [
    JSON.stringify({ ...metadata, libraryId: randomUUID() }),
    JSON.stringify({ ...metadata, current: 'a'.repeat(64) }),
    'invalid',
  ]) {
    writeFileSync(legacy, body);
    assert.throws(() => new LibraryStore(root));
    assert.equal(readFileSync(canonical, 'utf8'), original);
    assert.equal(readFileSync(legacy, 'utf8'), body);
  }
  rmSync(canonical);
  rmSync(legacy);
  symlinkSync(join(root, 'missing'), legacy);
  assert.throws(() => new LibraryStore(root));
  assert.equal(readdirSync(root).includes('instrucoes.json'), false);
});
