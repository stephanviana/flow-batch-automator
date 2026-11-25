import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openProject } from '../src/flow-projects.js';

test('opening a batch verifies the loaded document even when Chrome still reports the expected project', async (t) => {
  const url = 'https://flow.google.com/project/expected';
  const tab = { id: 3, url, status: 'complete' };
  const location = new URL('https://flow.google.com/');
  for (const [key, value] of Object.entries({
    location,
    WIZ_global_data: { SNlM0e: 'fixture' },
    chrome: {
      tabs: { query: async () => [tab], get: async () => tab },
      scripting: {
        executeScript: async (injection: {
          func: (expected: string) => boolean;
          args: [string];
        }) => [{ result: injection.func(...injection.args) }],
      },
    },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  let now = 0;
  t.mock.method(Date, 'now', () => (now += 11000));
  await assert.rejects(openProject('expected', false), /aguarde a página/);
  location.pathname = '/project/expected';
  assert.equal(await openProject('expected', false), tab.id);
});
