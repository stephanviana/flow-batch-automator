import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  listenNativeControl,
  requestNativeControl,
} from '../src/local-cli/native-control.js';
import {
  nativeAddress,
  type NativeRecord,
  type NativeStatus,
} from '../src/local-cli/native-state.js';
import {
  installationRuntime,
  installationSchema,
} from '../src/local-cli/config.js';

test('Windows defaults to native while legacy and Linux installations preserve Docker', () => {
  assert.equal(installationRuntime('win32', null), 'native');
  assert.equal(installationRuntime('linux', null), 'docker');
  const legacy = installationSchema.parse({
    version: 1,
    libraryDirectory: tmpdir(),
    extensionDirectory: tmpdir(),
    workspace: tmpdir(),
    project: 'fixture',
    volume: 'fixture_data',
    port: 4319,
  });
  assert.equal(legacy.runtime, 'docker');
  assert.equal(installationRuntime('linux', legacy), 'docker');
  assert.equal(installationRuntime('linux', legacy, 'native'), 'native');
  assert.throws(() => installationRuntime('win32', legacy), /--runtime native/);
  assert.throws(
    () => installationRuntime('win32', null, 'docker'),
    /--runtime native/,
  );
  assert.throws(() => installationRuntime('linux', null, 'other'));
  const address = nativeAddress(join(tmpdir(), 'Native data'), 'win32');
  assert.match(address, /^\\\\\.\\pipe\\flow-batch-[a-f0-9]{64}$/);
  assert.equal(address, nativeAddress(join(tmpdir(), 'NATIVE DATA'), 'win32'));
});

test('native control authenticates the instance, keeps secrets out of status and excludes a second owner', async (t) => {
  const address = nativeAddress(join(tmpdir(), `flow-control-${randomUUID()}`));
  const record: NativeRecord = {
    version: 1,
    instanceId: randomUUID(),
    secret: randomBytes(32).toString('hex'),
    pid: process.pid,
    port: 4319,
    startedAt: Date.now(),
  };
  const status: NativeStatus = {
    runtime: 'native',
    state: 'running',
    instanceId: record.instanceId,
    pid: record.pid,
    port: record.port,
    startedAt: record.startedAt,
  };
  let stops = 0;
  const server = await listenNativeControl(
    address,
    record,
    () => status,
    () => {
      stops++;
    },
  );
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await assert.rejects(
    requestNativeControl(
      address,
      { ...record, secret: '0'.repeat(64) },
      'stop',
    ),
    /indisponível/,
  );
  assert.equal(stops, 0);
  const result = await requestNativeControl(address, record, 'status');
  assert.deepEqual(result, status);
  assert.ok(!JSON.stringify(result).includes(record.secret));
  await assert.rejects(
    requestNativeControl(
      address,
      { ...record, instanceId: randomUUID() },
      'status',
    ),
    /indisponível/,
  );
  await assert.rejects(
    listenNativeControl(
      address,
      record,
      () => status,
      () => {},
    ),
  );
  await requestNativeControl(address, record, 'stop');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(stops, 1);
});
