import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  assetInputSchema,
  findImageInputSchema,
  projectFromUrl,
  isFlowUrl,
  requireProject,
  type AssetListing,
} from '../src/contracts.js';
import { browserConfig } from '../src/config.js';
import { profileEndpoint, selectFlowPage } from '../src/browser.js';
import { findExistingImage } from '../src/media.js';

const projectId = '11111111-1111-4111-8111-111111111111';

test('project identity requires the exact Flow origin and a valid project UUID', () => {
  assert.equal(
    projectFromUrl(`https://flow.google.com/project/${projectId}?hl=pt`),
    projectId,
  );
  assert.equal(
    projectFromUrl(`https://flow.google.com/project/${projectId}/edit/clip`),
    projectId,
  );
  for (const value of [
    `https://flow.google.com.evil.test/project/${projectId}`,
    `http://flow.google.com/project/${projectId}`,
    'https://flow.google.com/project/invalid',
    'not a url',
  ])
    assert.equal(projectFromUrl(value), null);
  assert.equal(isFlowUrl('https://flow.google.com.evil.test/'), false);
  assert.throws(
    () =>
      requireProject(
        `https://flow.google.com/project/${projectId}`,
        'different',
      ),
    /não corresponde/,
  );
});

test('discovery refuses ambiguous tabs and never silently selects another project', () => {
  const page = {
    url: (): string => `https://flow.google.com/project/${projectId}`,
  };
  const other = { url: (): string => 'https://example.test/' };
  assert.equal(selectFlowPage([other, page], projectId), page);
  assert.equal(selectFlowPage([other]), null);
  const login = {
    url: (): string => 'https://accounts.google.com/signin?continue=private',
  };
  assert.equal(selectFlowPage([login]), login);
  assert.throws(() => selectFlowPage([page, page]), /várias abas/);
  assert.throws(
    () => selectFlowPage([page], '22222222-2222-4222-8222-222222222222'),
    /Abra o projeto solicitado/,
  );
});

test('profile endpoint is local and tied to the dedicated profile', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'flow-browser-endpoint-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'DevToolsActivePort');
  assert.equal(await profileEndpoint(directory), null);
  await writeFile(file, '9333\r\n/devtools/browser/abc-123\r\n');
  assert.equal(
    await profileEndpoint(directory),
    'ws://127.0.0.1:9333/devtools/browser/abc-123',
  );
  for (const content of [
    '0\n/devtools/browser/abc',
    '65536\n/devtools/browser/abc',
    '9333\nhttps://external.test/',
    '9333\n/devtools/browser/abc?token=secret',
    'NaN\n/devtools/browser/abc',
  ]) {
    await writeFile(file, content);
    await assert.rejects(profileEndpoint(directory), /endpoint.*inválido/);
    assert.equal(await readFile(file, 'utf8'), content);
  }
});

test('configuration uses a separate profile and rejects relative paths', () => {
  const config = browserConfig({
    FLOW_BROWSER_HOME: join(tmpdir(), 'flow-browser-config'),
  });
  assert.equal(config.profile, join(config.home, 'chrome-profile'));
  assert.throws(
    () => browserConfig({ FLOW_BROWSER_HOME: 'relative' }),
    /absoluto/,
  );
  assert.throws(
    () => browserConfig({ FLOW_BROWSER_CHROME: 'chrome' }),
    /absoluto/,
  );
});

test('read tools accept no generation settings and keep inspection bounded', () => {
  assert.equal(assetInputSchema.parse({ projectId }).maxScrolls, 20);
  for (const input of [
    { projectId, execute: true },
    { projectId, limit: 201 },
    { projectId, maxScrolls: 41 },
    { projectId: '../escape' },
  ])
    assert.equal(assetInputSchema.safeParse(input).success, false);
  assert.equal(
    findImageInputSchema.safeParse({
      projectId,
      mediaId: 'https://signed.test/?token=secret',
    }).success,
    false,
  );
});

test('image lookup uses the media ID, refusing title matches and video IDs', () => {
  const listing: AssetListing = {
    projectId,
    scope: 'current-view',
    reachedEnd: false,
    unidentifiedTilesSeen: false,
    assets: [
      { mediaId: 'image-a', title: 'Same title', kind: 'image' },
      { mediaId: 'image-b', title: 'Same title', kind: 'image' },
      { mediaId: 'video-a', title: 'Same title', kind: 'video' },
    ],
  };
  assert.equal(findExistingImage(listing, 'image-b').mediaId, 'image-b');
  for (const id of ['Same title', 'missing', 'video-a'])
    assert.throws(
      () => findExistingImage(listing, id),
      /não foi confirmada por ID/,
    );
});
