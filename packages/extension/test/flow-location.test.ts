import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { FlowInspection } from '@flow-batch/protocol';
import { currentFlow } from '../src/flow-location.js';

const verified: FlowInspection = {
  phase: 'ready',
  projectId: 'previous-project',
  message: 'Sessão verificada.',
  checkedAt: 1,
};
function fixture(t: TestContext, tabs: Partial<chrome.tabs.Tab>[]): void {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      tabs: { query: async () => tabs },
      windows: { getLastFocused: async () => ({ id: 7 }) },
    },
  });
  t.after(() => Reflect.deleteProperty(globalThis, 'chrome'));
}
const project: Partial<chrome.tabs.Tab> = {
  id: 1,
  windowId: 7,
  active: true,
  status: 'complete',
  url: 'https://flow.google.com/project/previous-project',
};

test('a verified project remains identified only while that project is open', async (t) => {
  const tabs = [{ ...project }];
  fixture(t, tabs);
  assert.deepEqual(await currentFlow(verified), verified);
  tabs[0]!.url = 'https://flow.google.com/';
  const home = await currentFlow(verified);
  assert.equal(home.projectId, null);
  assert.equal(home.phase, 'not-ready');
  assert.match(home.message, /Nenhum projeto aberto/);
  tabs.length = 0;
  assert.equal((await currentFlow(verified)).phase, 'no-tab');
  assert.equal((await currentFlow(verified)).projectId, null);
});

test('switching projects or loading another document never carries over the previous verification', async (t) => {
  const tabs: Partial<chrome.tabs.Tab>[] = [
    { ...project, url: 'https://flow.google.com/project/new-project' },
  ];
  fixture(t, tabs);
  const changed = await currentFlow(verified);
  assert.equal(changed.projectId, 'new-project');
  assert.equal(changed.phase, 'not-ready');
  tabs[0] = { ...project, status: 'loading' };
  assert.equal((await currentFlow(verified)).phase, 'not-ready');
  tabs[0] = { ...project, pendingUrl: 'https://flow.google.com/' };
  assert.equal((await currentFlow(verified)).projectId, null);
});

test('the active Flow home takes precedence over an old background project and ambiguous tabs show no project', async (t) => {
  const tabs: Partial<chrome.tabs.Tab>[] = [
    { ...project, active: false },
    { ...project, id: 2, url: 'https://flow.google.com/' },
  ];
  fixture(t, tabs);
  assert.equal((await currentFlow(verified)).projectId, null);
  tabs[1] = {
    ...tabs[1],
    active: false,
    url: 'https://flow.google.com/project/another-project',
  };
  const ambiguous = await currentFlow(verified);
  assert.equal(ambiguous.projectId, null);
  assert.match(ambiguous.message, /Selecione uma aba/);
});

test('a tab lookup failure clears the project instead of returning a cached success', async (t) => {
  fixture(t, []);
  chrome.tabs.query = async (): Promise<chrome.tabs.Tab[]> => {
    throw new Error('Fixture: tab closed');
  };
  const current = await currentFlow(verified);
  assert.equal(current.phase, 'error');
  assert.equal(current.projectId, null);
});
