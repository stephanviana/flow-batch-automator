import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';
import {
  installInstructions,
  bundledInstructions,
} from '../src/library/install.js';
import { LibraryStore } from '../src/library/store.js';
import { draftFiles, writeDraft } from '../src/library/files.js';
import { emptyModules } from '../src/library/modular.js';
import { documentText } from '../src/library/document.js';

const edition = resolve('../../instrucoes');
function folder(t: { after(callback: () => void): void }): string {
  const path = mkdtempSync(join(tmpdir(), 'flow-install-edition-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
test('setup installs nine unchanged creative files only into new or pristine scaffolds, without archives', (t) => {
  const root = folder(t);
  assert.equal(Object.keys(bundledInstructions(edition)).length, 9);
  for (const scaffold of [false, true]) {
    const destination = join(root, `${scaffold} with spaces`);
    if (scaffold) new LibraryStore(destination);
    assert.deepEqual(installInstructions(edition, destination), {
      status: 'installed',
      files: 9,
    });
    assert.deepEqual(draftFiles(destination), draftFiles(edition));
    assert.equal(
      readdirSync(destination).some(
        (name) =>
          name === '.rascunhos' ||
          name.includes('backup') ||
          name.startsWith('.flow-'),
      ),
      false,
    );
    assert.equal(installInstructions(edition, destination).status, 'preserved');
  }
  assert.equal(installInstructions(edition, edition).status, 'preserved');
});
test('setup preserves removed formats, user edits, legacy/partial files and captured empty scaffolds', (t) => {
  const root = folder(t);
  const active = join(root, 'active');
  installInstructions(edition, active);
  const library = new LibraryStore(active);
  const captured = library.capture(['seller']);
  library.save('formatos/seller.md', 'Local edit', library.draft().hash);
  rmSync(join(active, 'formatos/pov.md'));
  const before = library.draft();
  const metadata = readFileSync(join(active, 'instrucoes.json'));
  assert.equal(installInstructions(edition, active).status, 'preserved');
  assert.deepEqual(library.draft(), before);
  assert.deepEqual(readFileSync(join(active, 'instrucoes.json')), metadata);
  assert.deepEqual(library.revision(captured.revision), captured);
  for (const [name, files] of Object.entries({
    legacy: { 'biblioteca.md': documentText() },
    partial: { 'base.md': 'User incomplete instructions' },
  })) {
    const destination = join(root, name);
    writeDraft(destination, files);
    assert.equal(installInstructions(edition, destination).status, 'preserved');
    assert.deepEqual(draftFiles(destination), files);
  }
  const archived = join(root, 'archived');
  new LibraryStore(archived);
  writeFileSync(
    join(archived, '.historico', 'unrecognized-capture'),
    'preserve',
  );
  assert.equal(installInstructions(edition, archived).status, 'preserved');
  assert.deepEqual(draftFiles(archived), emptyModules());
});
test('invalid editions and symbolic links are refused before writing destination files', (t) => {
  const root = folder(t);
  const invalid = join(root, 'invalid');
  writeDraft(invalid, emptyModules());
  assert.throws(() => installInstructions(invalid, join(root, 'not-created')));
  assert.equal(readdirSync(root).includes('not-created'), false);
  const active = join(root, 'active');
  new LibraryStore(active);
  const metadata = readFileSync(join(active, 'instrucoes.json'));
  rmSync(join(active, 'base.md'));
  symlinkSync(join(root, 'missing'), join(active, 'base.md'));
  assert.throws(() => installInstructions(edition, active), /links simbólicos/);
  assert.deepEqual(readFileSync(join(active, 'instrucoes.json')), metadata);
});

test('an interrupted installation restores earlier writes and preserves a concurrent user edit', (t) => {
  const root = folder(t);
  for (const concurrentEdit of [false, true]) {
    const active = join(root, String(concurrentEdit));
    const library = new LibraryStore(active);
    const before = library.draft();
    const rename = fs.renameSync;
    let interrupted = false;
    const mock = t.mock.method(
      fs,
      'renameSync',
      (source: fs.PathLike, destination: fs.PathLike) => {
        if (
          !interrupted &&
          String(destination) === join(active, 'formatos/factory-group.md')
        ) {
          interrupted = true;
          if (concurrentEdit)
            writeFileSync(join(active, 'base.md'), 'User concurrent edit');
          throw new Error('Synthetic interrupted write.');
        }
        return rename(source, destination);
      },
    );
    syncBuiltinESMExports();
    try {
      assert.throws(
        () => installInstructions(edition, active),
        /Synthetic interrupted write/,
      );
      assert.deepEqual(library.draft().files, {
        ...before.files,
        ...(concurrentEdit ? { 'base.md': 'User concurrent edit' } : {}),
      });
      assert.equal(readdirSync(active).includes('.flow-install'), false);
      assert.equal(readdirSync(active).includes('.rascunhos'), false);
    } finally {
      mock.mock.restore();
      syncBuiltinESMExports();
    }
  }
});
