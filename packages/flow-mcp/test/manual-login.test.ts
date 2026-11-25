import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { ProfileBrowser } from '../src/browser.js';
import { browserConfig } from '../src/config.js';
import { ManualLogin } from '../src/manual-login.js';
import { FlowBrowserService } from '../src/service.js';

test(
  'manual login starts no debugging endpoint and blocks control until the user closes it',
  { skip: process.platform === 'win32' },
  async (t) => {
    const home = await mkdtemp(join(tmpdir(), 'flow-browser-manual-login-'));
    const loginProcess = { pid: 0 };
    const executable = join(home, 'browser-fixture.cjs');
    const calls = join(home, 'arguments.json');
    await writeFile(
      executable,
      `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)));\nsetInterval(() => {}, 1000);\n`,
      { mode: 0o700 },
    );
    const config = browserConfig({
      FLOW_BROWSER_HOME: home,
      FLOW_BROWSER_CHROME: executable,
    });
    const manual = new ManualLogin(config);
    const browser = new ProfileBrowser(config);
    t.after(async () => {
      await browser.disconnect();
      if (loginProcess.pid && (await manual.isOpen()))
        process.kill(loginProcess.pid, 'SIGTERM');
      for (let round = 0; round < 20 && (await manual.isOpen()); round++)
        await delay(50);
      await rm(home, { recursive: true, force: true });
    });
    await mkdir(config.profile);
    await writeFile(join(config.profile, 'preserve.txt'), 'existing profile');
    const service = new FlowBrowserService(browser);
    assert.equal((await service.login()).phase, 'manual-login');
    loginProcess.pid = JSON.parse(
      await readFile(join(home, 'login-process.json'), 'utf8'),
    ).pid as number;
    const args = JSON.parse(await readFile(calls, 'utf8')) as string[];
    assert.deepEqual(args, [
      `--user-data-dir=${config.profile}`,
      '--no-default-browser-check',
      'https://flow.google.com/?hl=en',
    ]);
    assert.ok(
      args.every(
        (argument) =>
          !/debugging|automation|headless|disable.*security/i.test(argument),
      ),
    );
    assert.equal(await browser.connect(), null);
    assert.equal((await service.status()).phase, 'manual-login');
    await assert.rejects(service.connectSession(), /feche a janela manual/);
    assert.equal((await service.login()).phase, 'manual-login');
    assert.equal(
      await readFile(join(config.profile, 'preserve.txt'), 'utf8'),
      'existing profile',
    );
    process.kill(loginProcess.pid, 'SIGTERM');
    for (let round = 0; round < 20 && (await manual.isOpen()); round++)
      await delay(50);
    assert.equal(await manual.isOpen(), false);
    assert.equal((await service.status()).phase, 'browser-closed');
  },
);

test('malformed manual-login state is rejected without attempting a browser connection', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'flow-browser-manual-invalid-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, 'login-process.json'), '{invalid');
  const browser = new ProfileBrowser(
    browserConfig({ FLOW_BROWSER_HOME: home }),
  );
  await assert.rejects(browser.connect(), /estado local.*inválido/);
});
