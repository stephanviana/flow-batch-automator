import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { SimulationStore } from '../src/persistence/simulations.js';
import { fixture, pair, approve, signed } from './support.js';

test('server reopen preserves authorization and interrupts unfinished simulations without requeue', async (t) => {
  const f = await fixture(t);
  const receipt = await pair(f);
  await approve(f, receipt);
  const tasks = new SimulationStore(f.database);
  const interrupted = tasks.create(
    receipt.clientId,
    randomUUID(),
    randomUUID(),
    5000,
  );
  await f.app.close();
  const reopened = createApp(f.config);
  try {
    const proof = await signed(
      { ...f, app: reopened },
      receipt.clientId,
      'GET',
      '/api/identity',
    );
    assert.equal(
      (await reopened.inject({ url: '/api/identity', headers: proof.headers }))
        .statusCode,
      200,
    );
    const result = tasks.get(interrupted.id);
    assert.equal(result.state, 'interrupted');
    assert.equal(result.events.at(-1)?.reason, 'server-restart');
    assert.equal(
      f.database.prepare('SELECT COUNT(*) AS count FROM simulations').get()
        ?.count,
      1,
    );
  } finally {
    await reopened.close();
  }
});

test('phase 1 database upgrades transactionally while preserving foundation data', async (t) => {
  const f = await fixture(t);
  assert.equal(
    f.database
      .prepare(
        "SELECT value FROM application_metadata WHERE key = 'foundation'",
      )
      .get()?.value,
    '1',
  );
  assert.deepEqual(
    f.database
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => row.version),
    [1, 2],
  );
});
