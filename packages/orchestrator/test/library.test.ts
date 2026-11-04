import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { LibraryStore } from '../src/library/store.js';
import { seedFiles } from '../src/library/seed.js';
import { fixture, management } from './support.js';
import { image, draft, publication } from './orders-support.js';
import { MaterialFiles } from '../src/orders/material-files.js';
import { OrderRepository } from '../src/orders/repository.js';

const assets = new URL('../src/public/', import.meta.url);
test('external library preserves drafts, immutable revisions, restore and backup across installations', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'flow-library-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new LibraryStore(join(root, 'first'), seedFiles(assets));
  const original = store.current();
  store.save(
    'swipes/pov.txt',
    'Referência nova, sem publicação automática',
    store.draft().hash,
  );
  const revised = store.publish(store.draft().hash, 'Novo swipe');
  assert.equal(
    store.revision(original.revision).files['swipes/pov.txt'],
    undefined,
  );
  assert.equal(
    revised.files['swipes/pov.txt'],
    'Referência nova, sem publicação automática',
  );
  assert.throws(
    () => store.save('swipes/pov.txt', 'perda', '0'.repeat(64)),
    /rascunho mudou/,
  );
  store.save(
    'swipes/pov.txt',
    'Edição ainda não publicada',
    store.draft().hash,
  );
  const backup = store.export();
  const other = new LibraryStore(join(root, 'second'), seedFiles(assets));
  const previous = other.current();
  assert.ok(other.preview(backup).changes.includes('swipes/pov.txt'));
  other.import(backup, other.draft().hash);
  assert.equal(other.current().revision, revised.revision);
  assert.equal(
    other.draft().files['swipes/pov.txt'],
    'Edição ainda não publicada',
  );
  assert.equal(other.revision(previous.revision).revision, previous.revision);
  other.restore(original.revision, other.draft().hash);
  assert.equal(other.draft().files['swipes/pov.txt'], undefined);
  assert.equal(other.current().revision, revised.revision);
  const tampered = structuredClone(backup);
  tampered.revisions[0]!.files['swipes/pov.txt'] = 'alterado';
  assert.throws(
    () => other.import(tampered, other.draft().hash),
    /inconsistente/,
  );
  assert.throws(() =>
    other.save('instrucoes/../../secret.md', 'x', other.draft().hash),
  );
  writeFileSync(join(root, 'secret.txt'), 'confidencial');
  mkdirSync(join(root, 'second', 'swipes'), { recursive: true });
  symlinkSync(
    join(root, 'secret.txt'),
    join(root, 'second', 'swipes', 'link.txt'),
  );
  assert.throws(() => other.draft(), /links simbólicos/);
});

test('published library is pinned per lease and compiler; updating rules never changes prior preparations', async (t) => {
  const f = await fixture(t),
    headers = await management(f);
  const repository = new OrderRepository(f.database);
  const files = new MaterialFiles(
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
      (entry: { path: string }) =>
        entry.path === 'instrucoes/copy/vendedora.md',
    ),
  );
  assert.ok(
    !pinned.instructions.some((entry: { path: string }) =>
      /copy\/fabrica|swipes\//.test(entry.path),
    ),
  );
  const library = new LibraryStore(
    f.config.libraryDirectory,
    seedFiles(assets),
  );
  library.save(
    'instrucoes/animacao.md',
    library
      .current()
      .files['instrucoes/animacao.md']!.replaceAll(
        'Visual exclusions:',
        'UPDATED LIBRARY MARKER.\nVisual exclusions:',
      ),
    library.draft().hash,
  );
  const updated = library.publish(library.draft().hash, 'Novo template');
  const publicationBody = {
    ...(await publication(order, leaseId)),
    libraryRevision: pinned.revision,
  };
  const invalid = structuredClone(publicationBody);
  const invalidVariation = invalid.products[0]!.variations[1]!;
  invalidVariation.copy.hook = 'Teste {{campo}}.';
  const compilationFailure = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers,
    payload: invalid,
  });
  assert.equal(compilationFailure.statusCode, 400, compilationFailure.body);
  assert.ok(compilationFailure.json().error.includes(invalidVariation.id));
  assert.match(compilationFailure.json().error, /placeholder não resolvido/);
  const publish = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers,
    payload: publicationBody,
  });
  assert.equal(publish.statusCode, 200, publish.body);
  assert.equal(publish.json().preparation.library.revision, pinned.revision);
  assert.ok(!publish.body.includes('UPDATED LIBRARY MARKER'));
  const firstHash = publish.json().preparationHash;
  const second = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers,
    payload: publicationBody,
  });
  assert.equal(second.json().preparationHash, firstHash);
  const revise = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/claim`,
    headers,
    payload: { worker: 'mcp', revise: true },
  });
  assert.equal(revise.statusCode, 200, revise.body);
  const nextLeaseId = String(revise.json().leaseId);
  const wrong = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers,
    payload: { ...publicationBody, leaseId: nextLeaseId },
  });
  assert.equal(wrong.statusCode, 409);
  const next = await f.app.inject({
    method: 'POST',
    url: `/manage/orders/${order.id}/prepare`,
    headers,
    payload: {
      ...publicationBody,
      leaseId: nextLeaseId,
      libraryRevision: updated.revision,
    },
  });
  assert.equal(next.statusCode, 200, next.body);
  assert.ok(next.body.includes('UPDATED LIBRARY MARKER'));
  assert.notEqual(next.json().preparationHash, firstHash);
  assert.equal(
    f.database
      .prepare('SELECT COUNT(*) AS n FROM order_preparations WHERE order_id=?')
      .get(order.id)?.n,
    2,
  );
  assert.equal(
    f.database.prepare('SELECT COUNT(*) AS n FROM dispatch_commands').get()?.n,
    0,
  );
});

test('library API enforces local sessions, validates templates and reports exact schema paths', async (t) => {
  const f = await fixture(t),
    headers = await management(f);
  assert.equal(
    (await f.app.inject({ url: '/manage/library' })).statusCode,
    403,
  );
  const capabilities = await f.app.inject({
    url: '/manage/agent/capabilities',
    headers,
  });
  assert.equal(capabilities.json().contract, 'flow-orders/2');
  assert.equal(
    capabilities
      .json()
      .formats.find((format: { format: string }) => format.format === 'seller')
      .images,
    1,
  );
  const status = (
    await f.app.inject({ url: '/manage/library', headers })
  ).json();
  const saved = await f.app.inject({
    method: 'POST',
    url: '/manage/library/save',
    headers,
    payload: {
      path: 'instrucoes/animacao.md',
      text: 'inválido',
      expectedDraftHash: status.draftHash,
    },
  });
  const published = await f.app.inject({
    method: 'POST',
    url: '/manage/library/publish',
    headers,
    payload: { expectedDraftHash: saved.json().draftHash },
  });
  assert.equal(published.statusCode, 400);
  assert.match(published.json().error, /Template de animação/);
  const invalidRoutes = await f.app.inject({
    method: 'POST',
    url: '/manage/library/save',
    headers,
    payload: {
      path: 'instrucoes/rotas.json',
      text: '{',
      expectedDraftHash: saved.json().draftHash,
    },
  });
  const invalidRoutingPublication = await f.app.inject({
    method: 'POST',
    url: '/manage/library/publish',
    headers,
    payload: { expectedDraftHash: invalidRoutes.json().draftHash },
  });
  assert.equal(invalidRoutingPublication.statusCode, 400);
  assert.match(
    invalidRoutingPublication.json().error,
    /rotas.json contém JSON inválido/,
  );
  const rejected = await f.app.inject({
    method: 'POST',
    url: '/manage/orders/00000000-0000-4000-8000-000000000001/prepare',
    headers,
    payload: { leaseId: 'bad', products: [] },
  });
  assert.equal(rejected.statusCode, 400);
  assert.ok(
    rejected
      .json()
      .issues.some((issue: { path: string[] }) => issue.path[0] === 'leaseId'),
  );
  const exported = await f.app.inject({
    url: '/manage/library/export',
    headers,
  });
  const preview = await f.app.inject({
    method: 'POST',
    url: '/manage/library/import-preview',
    headers,
    payload: exported.json(),
  });
  assert.equal(preview.statusCode, 200, preview.body);
});
