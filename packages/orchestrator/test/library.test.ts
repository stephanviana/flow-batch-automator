import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { LibraryStore } from '../src/library/store.js';
import { instructions } from './instruction-fixture.js';
import { fixture, management } from './support.js';
import { image, draft, publication } from './orders-support.js';
import { MaterialFiles } from '../src/orders/material-files.js';
import { OrderRepository } from '../src/orders/repository.js';

test('installation is empty, imports instructions without bundled content, preserves captures and backup recovery', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'flow-instructions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new LibraryStore(join(root, 'first'));
  assert.equal(store.status().configured, false);
  assert.equal(store.status().revision, null);
  assert.throws(() => store.capture(), /incompleto/);
  instructions.installInstructions(store.root);
  const original = store.capture();
  store.save(
    'instrucoes/seller.md',
    'Updated technical fixture',
    store.draft().hash,
  );
  const revised = store.capture();
  assert.notEqual(revised.revision, original.revision);
  assert.equal(
    store.revision(original.revision).files['instrucoes/seller.md'],
    'Synthetic seller document.',
  );
  assert.equal(store.capture().revision, revised.revision);
  assert.throws(
    () => store.save('instrucoes/seller.md', 'lost', '0'.repeat(64)),
    /rascunho mudou/,
  );
  assert.throws(() => store.save('swipes/test.txt', 'no', store.draft().hash));
  const backup = store.export(),
    other = new LibraryStore(join(root, 'second'));
  other.import(backup, other.draft().hash);
  assert.equal(other.current().revision, revised.revision);
  other.restore(original.revision, other.draft().hash);
  assert.equal(other.current().revision, revised.revision);
  assert.equal(
    other.capture().files['instrucoes/seller.md'],
    'Synthetic seller document.',
  );
  const tampered = structuredClone(backup);
  tampered.revisions[0]!.files['instrucoes/seller.md'] = 'tampered';
  assert.throws(
    () => other.import(tampered, other.draft().hash),
    /inconsistente/,
  );
  assert.throws(() =>
    other.save('instrucoes/../../secret.md', 'x', other.draft().hash),
  );
  writeFileSync(join(root, 'secret.txt'), 'confidential');
  symlinkSync(
    join(root, 'secret.txt'),
    join(other.root, 'instrucoes/link.txt'),
  );
  assert.throws(() => other.draft(), /links simbólicos/);
});

test('reservation automatically captures local edits and keeps older templates immutable', async (t) => {
  const f = await fixture(t),
    headers = await management(f);
  const repository = new OrderRepository(f.database),
    files = new MaterialFiles(
      f.config.materialsDirectory,
      repository.materials,
    );
  const material = await files.import(Readable.from(image), 'produto.png');
  const input = draft(material.id);
  input.products = [input.products[1]!];
  const order = repository.create(input);
  const claim = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/claim`,
    headers,
    payload: { worker: 'mcp' },
  });
  assert.equal(claim.statusCode, 200, claim.body);
  const leaseId = String(claim.json().leaseId);
  const context = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/context`,
    headers,
    payload: { leaseId },
  });
  const pinned = context.json();
  assert.ok(
    pinned.instructions.some(
      (entry: { path: string }) => entry.path === 'instrucoes/seller.md',
    ),
  );
  assert.ok(
    !pinned.instructions.some((entry: { path: string }) =>
      /factory.md|swipes/.test(entry.path),
    ),
  );
  const library = new LibraryStore(f.config.libraryDirectory);
  library.save(
    'instrucoes/animacao.md',
    library
      .draft()
      .files['instrucoes/animacao.md']!.replaceAll(
        'Visual exclusions:',
        'UPDATED MARKER\nVisual exclusions:',
      ),
    library.draft().hash,
  );
  const publicationBody = {
    ...(await publication(order, leaseId)),
    libraryRevision: pinned.revision,
  };
  const invalid = structuredClone(publicationBody),
    variation = invalid.products[0]!.variations[1]!;
  variation.copy.hook = 'Teste {{campo}}.';
  const failure = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers,
    payload: invalid,
  });
  assert.equal(failure.statusCode, 400, failure.body);
  assert.ok(failure.json().error.includes(variation.id));
  const publish = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers,
    payload: publicationBody,
  });
  assert.equal(publish.statusCode, 200, publish.body);
  assert.ok(!publish.body.includes('UPDATED MARKER'));
  const firstHash = publish.json().preparationHash;
  const replay = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers,
    payload: publicationBody,
  });
  assert.equal(replay.json().preparationHash, firstHash);
  const revise = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/claim`,
    headers,
    payload: { worker: 'mcp', revise: true },
  });
  assert.equal(revise.statusCode, 200, revise.body);
  const nextLease = String(revise.json().leaseId),
    revision = library.current().revision;
  assert.notEqual(revision, pinned.revision);
  const wrong = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers,
    payload: { ...publicationBody, leaseId: nextLease },
  });
  assert.equal(wrong.statusCode, 409);
  const next = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers,
    payload: {
      ...publicationBody,
      leaseId: nextLease,
      libraryRevision: revision,
    },
  });
  assert.equal(next.statusCode, 200, next.body);
  assert.ok(next.body.includes('UPDATED MARKER'));
  assert.notEqual(next.json().preparationHash, firstHash);
  assert.equal(
    f.database.prepare('SELECT COUNT(*) AS n FROM dispatch_commands').get()?.n,
    0,
  );
});

test('panel has no instruction editor and missing configuration cannot reserve an order', async (t) => {
  const f = await fixture(t),
    headers = await management(f);
  assert.equal(
    (await f.app.inject({ url: '/library', headers })).statusCode,
    404,
  );
  assert.equal(
    (await f.app.inject({ url: '/manage/library' })).statusCode,
    403,
  );
  assert.equal(
    (await f.app.inject({ url: '/agent/flow-batch-mcp.mjs', headers }))
      .statusCode,
    200,
  );
  const repository = new OrderRepository(f.database),
    files = new MaterialFiles(
      f.config.materialsDirectory,
      repository.materials,
    );
  const material = await files.import(Readable.from(image), 'produto.png'),
    order = repository.create(draft(material.id));
  writeFileSync(join(f.config.libraryDirectory, 'instrucoes/rotas.json'), '{');
  const claim = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/claim`,
    headers,
    payload: { worker: 'mcp' },
  });
  assert.equal(claim.statusCode, 400);
  assert.match(claim.json().error, /rotas.json contém JSON inválido/);
  assert.equal(repository.get(order.id).state, 'awaiting-preparation');
  const rejected = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers,
    payload: { leaseId: 'bad', products: [] },
  });
  assert.equal(rejected.statusCode, 400);
  assert.ok(
    rejected
      .json()
      .issues.some((issue: { path: string[] }) => issue.path[0] === 'leaseId'),
  );
});
