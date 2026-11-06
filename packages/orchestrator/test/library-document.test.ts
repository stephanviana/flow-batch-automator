import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryStore } from '../src/library/store.js';
import {
  documentText,
  documentSections,
  resolvedFiles,
} from '../src/library/document.js';
import {
  animationText,
  consolidatedDocument,
  instructionPaths,
} from '../src/library/routing.js';
import { instructions } from './instruction-fixture.js';

test('a new library has one empty instruction document and reports its missing sections', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'flow-document-empty-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new LibraryStore(root);
  assert.deepEqual(store.status().files, ['biblioteca.md']);
  assert.equal(store.status().format, 'document');
  assert.equal(store.status().configured, false);
  assert.match(store.status().problem!, /biblioteca.md/);
  assert.deepEqual(readdirSync(root).sort(), [
    '.historico',
    'biblioteca.json',
    'biblioteca.md',
  ]);
  assert.ok(
    Object.values(
      documentSections(readFileSync(join(root, 'biblioteca.md'), 'utf8')),
    ).every((text) => text === ''),
  );
});

test('single-document capture selects the requested formats and validates their templates without other formats', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'flow-document-selection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const text = documentText({
    common: 'Common fixture.',
    seller: 'Seller fixture.',
    animation: instructions.animationTemplates,
  });
  writeFileSync(join(root, 'biblioteca.md'), text);
  const store = new LibraryStore(root);
  const captured = store.capture(['seller']);
  assert.deepEqual(captured.files, { 'biblioteca.md': text });
  const selected = instructionPaths(captured.files, ['seller']);
  assert.deepEqual(selected, ['instrucoes/common.md', 'instrucoes/seller.md']);
  assert.equal(resolvedFiles(captured.files)[selected[1]!], 'Seller fixture.');
  assert.equal(animationText(captured.files), instructions.animationTemplates);
  assert.throws(() => store.capture(['clone']), /\[clone\]/);
  assert.equal(store.status().configured, false);
});

test('conversion and portable Markdown preserve instructions, old captures and recoverable originals', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'flow-document-convert-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  instructions.installInstructions(root);
  const store = new LibraryStore(root);
  const old = store.capture();
  const oldFiles = structuredClone(old.files);
  store.convert(store.draft().hash);
  const converted = store.capture();
  assert.equal(store.status().format, 'document');
  assert.equal(store.status().configured, true);
  const text = store.draft().files['biblioteca.md']!;
  for (const [name, contents] of Object.entries(oldFiles))
    if (name.endsWith('.md')) assert.ok(text.includes(contents));
  assert.equal(animationText(converted.files), animationText(oldFiles));
  assert.deepEqual(store.revision(old.revision), old);
  const archive = readdirSync(join(root, '.rascunhos'))[0]!;
  assert.equal(
    readFileSync(
      join(root, '.rascunhos', archive, 'instrucoes/seller.md'),
      'utf8',
    ),
    oldFiles['instrucoes/seller.md'],
  );
  const destination = new LibraryStore(join(root, 'other-machine'));
  destination.importDocument(text, destination.draft().hash);
  assert.equal(destination.status().configured, true);
  assert.equal(destination.capture().files['biblioteca.md'], text);
  store.save(
    'biblioteca.md',
    text.replace('Synthetic common', 'Updated common'),
    store.draft().hash,
  );
  assert.equal(store.revision(converted.revision).files['biblioteca.md'], text);
  const restored = new LibraryStore(join(root, 'full-backup'));
  restored.import(store.export(), restored.draft().hash);
  assert.equal(restored.current().revision, converted.revision);
  restored.restore(old.revision, restored.draft().hash);
  assert.deepEqual(restored.draft().files, oldFiles);
});

test('document boundaries ignore fenced headings, accept Windows newlines and reject ambiguous sections', () => {
  const text = documentText({
    common: 'Before\n```md\n# [seller] literal example\n```\nAfter',
    seller: 'Real seller',
  });
  assert.equal(
    documentSections('\uFEFF' + text.replaceAll('\n', '\r\n')).seller,
    'Real seller',
  );
  assert.match(documentSections(text).common!, /# \[seller\] literal example/);
  for (const invalid of [
    text + '# [seller] duplicate\n',
    text + '# [unknown] unknown\n',
    text + '# [toString] invalid\n',
    text + '```text\nunclosed',
    'unmarked',
  ])
    assert.throws(() => documentSections(invalid));
});

test('invalid documents never fall back to separate files and failed imports preserve the active library', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'flow-document-refusal-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  instructions.installInstructions(root);
  const store = new LibraryStore(root);
  const original = store.draft();
  assert.throws(
    () => store.importDocument(documentText(), original.hash),
    /incompleto/,
  );
  assert.deepEqual(store.draft(), original);
  writeFileSync(
    join(root, 'biblioteca.md'),
    consolidatedDocument(original.files),
  );
  assert.throws(() => store.capture(), /misturar/);
  rmSync(join(root, 'biblioteca.md'));
  const external = join(root, 'external.md');
  writeFileSync(external, 'preserved');
  symlinkSync(external, join(root, 'biblioteca.md'));
  assert.throws(() => store.draft());
  assert.equal(readFileSync(external, 'utf8'), 'preserved');
});
