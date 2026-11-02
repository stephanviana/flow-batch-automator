import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';

test('local defaults bind to loopback and use a persistent database', () => {
  const config = loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 4319);
  assert.ok(config.databasePath.endsWith('/data/flow-batch.sqlite'));
});

test('invalid configuration is rejected without echoing supplied values', () => {
  assert.throws(
    () => loadConfig({ PORT: 'secret-value' }),
    /^Error: Invalid configuration fields: PORT$/,
  );
  for (const environment of [
    { HOST: '192.168.1.2' },
    { PORT: '80' },
    { SQLITE_BUSY_TIMEOUT_MS: '0' },
    { DATABASE_PATH: ':memory:' },
  ]) {
    assert.throws(() => loadConfig(environment));
  }
});
