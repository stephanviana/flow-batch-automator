import assert from 'node:assert/strict';
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { browserConfig } from '../src/config.js';
import {
  listBrowserProfiles,
  loadBrowserConfig,
  saveBrowserExecutable,
  saveBrowserProfile,
} from '../src/settings.js';

test('saved executable survives a new process configuration without touching the browser profile', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'flow-browser-settings-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { FLOW_BROWSER_HOME: home };
  const initial = await loadBrowserConfig(env);
  assert.equal(initial.executable, undefined);
  assert.deepEqual(await readdir(home), []);
  await saveBrowserExecutable(initial, process.execPath);
  assert.equal((await loadBrowserConfig(env)).executable, process.execPath);
  assert.deepEqual(await readdir(home), ['settings.json']);
  if (process.platform !== 'win32')
    assert.equal((await stat(join(home, 'settings.json'))).mode & 0o777, 0o600);
  assert.equal(
    (
      await loadBrowserConfig({
        ...env,
        FLOW_BROWSER_CHROME: join(home, 'explicit-chrome'),
      })
    ).executable,
    join(home, 'explicit-chrome'),
  );
});

test('settings changes create no backup and preserve unrelated local files', async (t) => {
  const home = await mkdtemp(
    join(tmpdir(), 'flow-browser-settings-preservation-'),
  );
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, 'keep.txt'), 'preserve');
  const config = browserConfig({ FLOW_BROWSER_HOME: home });
  await saveBrowserExecutable(config, process.execPath);
  await saveBrowserExecutable(config, process.execPath);
  assert.deepEqual((await readdir(home)).sort(), ['keep.txt', 'settings.json']);
  assert.equal(await readFile(join(home, 'keep.txt'), 'utf8'), 'preserve');
  await assert.rejects(
    saveBrowserExecutable(config, 'relative-chrome'),
    /absoluto/,
  );
  await assert.rejects(
    saveBrowserExecutable(config, join(home, 'missing')),
    /não existe/,
  );
});

test('configuration from another OS is ignored and invalid configuration fails closed', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'flow-browser-settings-platform-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const file = join(home, 'settings.json');
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      platform: process.platform === 'win32' ? 'linux' : 'win32',
      chrome: 'foreign-os-path',
    }),
  );
  assert.equal(
    (await loadBrowserConfig({ FLOW_BROWSER_HOME: home })).executable,
    undefined,
  );
  await writeFile(file, '{invalid JSON');
  await assert.rejects(
    loadBrowserConfig({ FLOW_BROWSER_HOME: home }),
    /configuração.*inválida/,
  );
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      platform: process.platform,
      chrome: 'relative',
    }),
  );
  await assert.rejects(
    loadBrowserConfig({ FLOW_BROWSER_HOME: home }),
    /absoluto/,
  );
});

test('named profiles keep default chrome-profile intact, isolate profiles, and reject invalid names', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'flow-browser-profiles-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { FLOW_BROWSER_HOME: home };
  const initial = await loadBrowserConfig(env);
  assert.equal(initial.activeProfile, 'default');
  assert.equal(initial.profile, join(home, 'chrome-profile'));
  const switched = await saveBrowserProfile(initial, 'conta-2');
  assert.equal(switched.activeProfile, 'conta-2');
  assert.equal(switched.profile, join(home, 'profiles', 'conta-2'));
  const reloaded = await loadBrowserConfig(env);
  assert.equal(reloaded.activeProfile, 'conta-2');
  assert.equal(reloaded.profile, join(home, 'profiles', 'conta-2'));
  const listed = await listBrowserProfiles(reloaded);
  assert.equal(listed.activeProfile, 'conta-2');
  assert.deepEqual(
    listed.profiles.map((entry) => entry.name),
    ['default', 'conta-2'],
  );
  await assert.rejects(saveBrowserProfile(reloaded, '../escape'), /inválido/);
});
