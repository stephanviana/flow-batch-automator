import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tarArchive, extendedAttribute } from '../test-support/npm-archive.mjs';
import { archiveEntries } from '../npm/tar.mjs';
import { inspectEntries } from '../npm/privacy.mjs';
import { auditPackage } from '../npm/audit.mjs';
import {
  distributionManifest,
  releaseMetadata,
  repositoryRoot,
} from '../npm/manifest.mjs';
import {
  graphPackages,
  productionOverrides,
  verifyDependencyLock,
} from '../npm/dependencies.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'flow-npm-audit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const expectedGraph = graphPackages({ example: { version: '1.0.0' } });
async function fixtureRelease() {
  return { ...(await releaseMetadata()), dependencies: { example: '1.0.0' } };
}
function fixtureLock(release) {
  return {
    name: release.name,
    version: release.version,
    lockfileVersion: 3,
    packages: {
      '': { dependencies: release.dependencies },
      'node_modules/example': {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz',
        integrity: 'sha512-' + 'A'.repeat(86) + '==',
      },
    },
  };
}
async function candidate(root, release, changes = []) {
  const names = JSON.parse(
    await readFile(join(repositoryRoot, 'packaging/npm-files.json'), 'utf8'),
  );
  const entries = names.map((path) => ({
    path: `package/${path}`,
    text:
      path === 'package.json'
        ? JSON.stringify(distributionManifest(release))
        : path === 'runtime/package-lock.json'
          ? JSON.stringify(fixtureLock(release))
          : '',
  }));
  for (const change of changes) {
    const existing = entries.findIndex(
      (entry) => entry.path === `package/${change.path}`,
    );
    const entry = { ...change, path: `package/${change.path}` };
    if (existing >= 0) entries[existing] = entry;
    else entries.push(entry);
  }
  const path = join(root, 'candidate.tgz');
  await writeFile(path, tarArchive(entries));
  return path;
}

test('release audit accepts the configured publication manifest and only allowlisted files', async (t) => {
  const root = await fixture(t),
    release = await fixtureRelease();
  const path = await candidate(root, release);
  const review = await auditPackage(path, release, expectedGraph);
  assert.equal(review.name, release.name);
  assert.equal(review.access, release.access);
  assert.equal(distributionManifest(release).private, undefined);
  assert.equal(review.sha256.length, 64);
  const altered = archiveEntries(await readFile(path)).map((entry) => ({
    path: entry.path,
    text:
      entry.path === 'package/package.json'
        ? 'npm_' + 'Z'.repeat(40)
        : entry.content,
  }));
  await writeFile(path, tarArchive(altered));
  await assert.rejects(
    auditPackage(path, release, expectedGraph),
    (error) =>
      error.message === 'Invalid release JSON. Contents were not logged.',
  );
  await candidate(root, release, [
    { path: '.npmrc', text: 'test-placeholder' },
  ]);
  await assert.rejects(
    auditPackage(path, release, expectedGraph),
    /unexpected or missing/,
  );
});

test('audit scans nested archives and binary bytes, refusing secrets, personal paths, metadata and unsafe payloads without echoing contents', async (t) => {
  const root = await fixture(t),
    release = await fixtureRelease();
  const cases = [
    { path: 'dist/main.mjs', text: 'npm_' + 'A'.repeat(40) },
    { path: 'dist/main.mjs', text: '/home/real-person/project/file' },
    { path: 'dist/main.mjs', text: 'C:\\Users\\real-person\\private' },
    { path: 'dist/main.mjs', text: '-----BEGIN PRIVATE KEY-----' },
    {
      path: 'dist/public/orders.css',
      text: '\u0000' + 'ghp_' + 'B'.repeat(36),
    },
    {
      path: 'dist/main.mjs',
      text: '{"dependency":"file:///Users/real-person/project"}',
    },
    { path: 'dist/.env', text: 'sensitive=test' },
    { path: 'node_modules/.modules.yaml', text: 'metadata' },
    { path: 'dist/main.js.map', text: '{}' },
    {
      path: 'dist/extra.tgz',
      text: tarArchive([{ path: 'config', text: 'hidden' }]),
    },
    { path: 'dist/main.mjs', text: 'safe', owner: 'personal-owner' },
    { path: 'personal/home-path', type: '2', link: '/home/real-person/file' },
  ];
  for (const entry of cases) {
    const path = await candidate(root, release, [entry]);
    await assert.rejects(
      auditPackage(path, release, expectedGraph),
      (error) => {
        assert.ok(!error.message.includes('real-person'));
        assert.ok(!error.message.includes('AAAA'));
        return true;
      },
    );
  }
  const safe = inspectEntries(
    archiveEntries(
      tarArchive([
        { path: 'README.md', text: '/mnt/c/Users/SEU_USUARIO/extension' },
      ]),
    ),
    [],
  );
  assert.deepEqual(safe, []);
});

test('tar reader checks traversal, link containment, duplicate entries, checksums and extended long paths', () => {
  for (const path of ['/absolute', '../escape', 'a/../escape', 'C:/escape'])
    assert.throws(() => archiveEntries(tarArchive([{ path }])));
  assert.throws(
    () => archiveEntries(tarArchive([{ path: 'same' }, { path: 'same' }])),
    /Duplicate/,
  );
  assert.throws(
    () =>
      archiveEntries(
        tarArchive([{ path: 'dist/link', type: '2', link: '../../escape' }]),
      ),
    /Unsafe/,
  );
  const linked = archiveEntries(
    tarArchive([{ path: 'node_modules/a/link', type: '2', link: '../b' }]),
  );
  assert.equal(linked[0].link, '../b');
  const corrupted = gunzipSync(tarArchive([{ path: 'file' }]));
  corrupted[0] ^= 1;
  assert.throws(() => archiveEntries(gzipSync(corrupted)), /checksum/);
  const long = 'dist/' + 'a'.repeat(150) + '.js';
  const entries = archiveEntries(
    tarArchive([
      { path: 'PaxHeader', type: 'x', text: extendedAttribute('path', long) },
      { path: 'placeholder', text: 'safe' },
    ]),
  );
  assert.equal(entries[0].path, long);
  assert.throws(
    () =>
      archiveEntries(
        tarArchive([
          {
            path: 'PaxHeader',
            type: 'x',
            text: extendedAttribute('path', '../escape'),
          },
          { path: 'placeholder' },
        ]),
      ),
    /Unsafe/,
  );
});

test('production graph projection merges abbreviated pnpm branches and preserves context-specific versions', () => {
  const graph = graphPackages({
    a: { version: '1.0.0', dependencies: { shared: { version: '1.0.0' } } },
    b: { version: '2.0.0', dependencies: { shared: { version: '2.0.0' } } },
    c: { version: '1.0.0', dependencies: { a: { version: '1.0.0' } } },
  });
  const overrides = productionOverrides(graph);
  assert.deepEqual(overrides.a, { '.': '1.0.0', shared: '1.0.0' });
  assert.deepEqual(overrides.b, { '.': '2.0.0', shared: '2.0.0' });
  assert.equal(overrides.shared, undefined);
  assert.equal(overrides.c, '1.0.0');
  assert.throws(() =>
    graphPackages({ a: { version: 'file:///home/example-person/project' } }),
  );
});
test('production lockfile must match the application and locked production graph, using only registry tarballs with integrity', async () => {
  const release = await fixtureRelease();
  const lock = fixtureLock(release);
  verifyDependencyLock(lock, release, expectedGraph);
  for (const replacement of [
    { version: '2.0.0' },
    { resolved: 'file:///home/example-person/package' },
    { resolved: 'https://other.example/package.tgz' },
    { resolved: 'https://registry.npmjs.org/other/-/other-1.0.0.tgz' },
    { integrity: undefined },
    { dev: true },
    { link: true },
  ]) {
    const changed = JSON.parse(JSON.stringify(lock));
    Object.assign(changed.packages['node_modules/example'], replacement);
    assert.throws(() => verifyDependencyLock(changed, release, expectedGraph));
  }
  const missing = JSON.parse(JSON.stringify(lock));
  delete missing.packages['node_modules/example'];
  assert.throws(() => verifyDependencyLock(missing, release, expectedGraph));
});

test('the production lockfile preserves distinct transitive branches instead of only matching a version set', async () => {
  const release = {
    ...(await fixtureRelease()),
    dependencies: { a: '1.0.0', b: '1.0.0' },
  };
  const graph = graphPackages({
    a: { version: '1.0.0', dependencies: { shared: { version: '1.0.0' } } },
    b: { version: '1.0.0', dependencies: { shared: { version: '2.0.0' } } },
  });
  const entry = (name, version) => ({
    version,
    resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
    integrity: 'sha512-' + 'A'.repeat(86) + '==',
  });
  const lock = {
    name: release.name,
    version: release.version,
    lockfileVersion: 3,
    packages: {
      '': { dependencies: release.dependencies },
      'node_modules/a': entry('a', '1.0.0'),
      'node_modules/b': entry('b', '1.0.0'),
      'node_modules/shared': entry('shared', '1.0.0'),
      'node_modules/b/node_modules/shared': entry('shared', '2.0.0'),
    },
  };
  verifyDependencyLock(lock, release, graph);
  lock.packages['node_modules/a/node_modules/shared'] =
    lock.packages['node_modules/b/node_modules/shared'];
  delete lock.packages['node_modules/b/node_modules/shared'];
  assert.throws(
    () => verifyDependencyLock(lock, release, graph),
    /resolution differs/,
  );
});
