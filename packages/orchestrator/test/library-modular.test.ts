import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { LibraryFiles } from '@flow-batch/protocol';
import { LibraryStore, filesHash } from '../src/library/store.js';
import {
  baseDocument,
  baseSections,
  emptyModules,
} from '../src/library/modular.js';
import { documentText, documentSections } from '../src/library/document.js';
import {
  instructionPaths,
  animationText,
  consolidatedDocument,
  validateLibrary,
} from '../src/library/routing.js';
import { draftFiles, writeDraft } from '../src/library/files.js';
import { previewSplit, splitFiles } from '../src/library/split.js';
import { createMcpServer } from '../src/mcp/server.js';
import { fixture, management } from './support.js';
import { instructions } from './instruction-fixture.js';
import type { AgentApi } from '../src/agent-client/http.js';

function folder(t: { after(callback: () => void): void }): string {
  const path = mkdtempSync(join(tmpdir(), 'flow-modules-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function modules(): LibraryFiles {
  return {
    ...emptyModules(),
    'base.md': baseDocument({
      copy: 'Copy fixture.',
      image: 'Image fixture.',
      animation: instructions.animationTemplates,
    }),
    'formatos/seller.md': 'Seller fixture.',
  };
}
test('modular captures select only requested formats and preserve original bytes, templates and identities after edits', (t) => {
  const root = folder(t);
  const files = modules();
  files['base.md'] = '\uFEFF' + files['base.md']!.replaceAll('\n', '\r\n');
  writeDraft(root, files);
  const store = new LibraryStore(root);
  const capture = store.capture(['seller']);
  assert.deepEqual(capture.files, files);
  assert.deepEqual(instructionPaths(files, ['seller']), [
    'base.md',
    'formatos/seller.md',
  ]);
  assert.equal(animationText(files), instructions.animationTemplates);
  assert.throws(() => store.capture(['pov']), /formatos\/pov.md/);
  store.save('formatos/seller.md', 'Updated seller.', store.draft().hash);
  assert.deepEqual(store.revision(capture.revision), capture);
  assert.throws(
    () => store.save('biblioteca.md', documentText(), store.draft().hash),
    /misture/,
  );
  assert.throws(
    () => store.save('instrucoes/other.md', 'Mixed', store.draft().hash),
    /misture/,
  );
  assert.throws(
    () => store.save('formatos/seller.md', 'Stale', filesHash(files)),
    /rascunho mudou/,
  );
  assert.throws(
    () => store.save('base.md', 'Invalid', store.draft().hash),
    /flow-base/,
  );
  assert.throws(
    () => validateLibrary({ ...files, 'formatos/unknown.md': 'Unknown' }),
    /desconhecidos/,
  );
  assert.throws(
    () =>
      validateLibrary(
        {
          ...files,
          'base.md': baseDocument({
            animation: instructions.animationTemplates,
          }),
        },
        ['seller'],
      ),
    /base.md/,
  );
  assert.throws(
    () =>
      validateLibrary(
        { ...files, 'base.md': baseDocument({ common: 'Rules' }) },
        ['seller'],
      ),
    /animation/,
  );
});
test('split preview is read-only, conversion preserves every section and previous revisions', (t) => {
  const root = folder(t);
  const text = documentText({
    common: 'Common',
    copy: 'Copy',
    image: 'Image',
    seller: 'Seller',
    animation: instructions.animationTemplates,
  });
  writeFileSync(join(root, 'biblioteca.md'), text);
  const files = draftFiles(root);
  const preview = previewSplit(files, filesHash(files));
  assert.equal(preview.preview, true);
  assert.equal(preview.files.length, 9);
  assert.deepEqual(readdirSync(root), ['biblioteca.md']);
  const result = execFileSync(
    process.execPath,
    [resolve('../../scripts/library.mjs'), 'split', root],
    {
      env: { ...process.env, FLOW_BATCH_HOME: join(root, 'uncreated-state') },
      encoding: 'utf8',
    },
  );
  assert.equal(JSON.parse(result).preview, true);
  assert.deepEqual(readdirSync(root), ['biblioteca.md']);
  const store = new LibraryStore(root);
  const old = store.capture(['seller']);
  store.split(store.draft().hash, true); // Explicit archive authorization for synthetic fixture only.
  const divided = store.capture(['seller']);
  assert.deepEqual(baseSections(divided.files['base.md']!), {
    common: 'Common',
    copy: 'Copy',
    image: 'Image',
    animation: instructions.animationTemplates,
  });
  assert.equal(divided.files['formatos/seller.md'], 'Seller');
  assert.deepEqual(store.revision(old.revision), old);
  assert.ok(existsSync(join(root, '.rascunhos')));
  const roundtrip = consolidatedDocument({
    ...splitFiles(files),
    ...Object.fromEntries(
      [
        'factory',
        'factory-group',
        'factory-truck',
        'factory-inclined',
        'pov',
        'full-pov',
        'clone',
      ].map((format) => [`formatos/${format}.md`, 'Fixture']),
    ),
  });
  assert.equal(documentSections(roundtrip).copy, 'Copy');
});
test('HTTP and MCP resolve the modular default and read captured instructions after editing the active file', async (t) => {
  const f = await fixture(t);
  rmSync(join(f.config.libraryDirectory, 'instrucoes'), { recursive: true });
  writeDraft(f.config.libraryDirectory, modules());
  const library = new LibraryStore(f.config.libraryDirectory);
  const capture = library.capture(['seller']);
  const headers = await management(f);
  const api: AgentApi = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await f.app.inject({
      method: body ? 'POST' : 'GET',
      url: path,
      headers,
      ...(body ? { payload: body } : {}),
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json() as T;
  };
  const first = await api<{ path: string; text: string }>(
    '/manage/library/file',
    {},
  );
  assert.equal(first.path, 'base.md');
  const next = baseDocument({
    common: 'New instructions.',
    animation: instructions.animationTemplates,
  });
  await api('/manage/library/save', {
    text: next,
    expectedDraftHash: library.draft().hash,
  });
  assert.equal(
    (
      await api<{ text: string }>('/manage/library/file', {
        revision: capture.revision,
      })
    ).text,
    first.text,
  );
  const server = createMcpServer(
    api,
    join(f.config.materialsDirectory, 'workspace'),
  );
  const client = new Client({ name: 'modular-fixture', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const result = await client.callTool({
    name: 'flow_library_read',
    arguments: {},
  });
  assert.equal(result.isError, undefined);
  assert.ok(JSON.stringify(result).includes('New instructions.'));
});
test('scaffold and preview refuse symbolic links including parent directories without writing through them', (t) => {
  const root = folder(t);
  const target = join(root, 'target');
  writeDraft(target, modules());
  const linked = join(root, 'linked');
  symlinkSync(target, linked);
  assert.throws(() => new LibraryStore(linked), /links simbólicos/);
  assert.equal(existsSync(join(target, 'instrucoes.json')), false);
  const original = readFileSync(join(target, 'base.md'), 'utf8');
  rmSync(join(target, 'base.md'));
  symlinkSync(join(root, 'missing'), join(target, 'base.md'));
  assert.throws(
    () => previewSplit(draftFiles(target), '0'.repeat(64)),
    /links simbólicos/,
  );
  assert.ok(original.length > 0);
});
