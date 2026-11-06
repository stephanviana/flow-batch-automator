import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, management } from './support.js';

const duration = 30 * 60 * 1000;
test('same-origin renewal keeps an active session, recovers expiry and never authorizes the extension', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = await fixture(t);
  const headers = await management(f);
  t.mock.timers.tick(duration - 60_000);
  const renewed = await f.app.inject({
    method: 'POST',
    url: '/manage/session',
    headers,
  });
  assert.equal(renewed.statusCode, 200);
  assert.deepEqual(renewed.json(), { ok: true });
  const retained = String(renewed.headers['set-cookie']).split(';')[0];
  assert.ok(
    retained === headers.cookie,
    'An active session should be retained',
  );
  assert.match(
    String(renewed.headers['set-cookie']),
    /Path=\/manage; HttpOnly; SameSite=Strict; Max-Age=1800/,
  );
  t.mock.timers.tick(120_000);
  assert.equal(
    (await f.app.inject({ url: '/manage/status', headers })).statusCode,
    200,
  );
  t.mock.timers.tick(duration);
  const expired = await f.app.inject({ url: '/manage/orders', headers });
  assert.equal(expired.statusCode, 403);
  assert.equal(
    expired.json<{ code: string }>().code,
    'MANAGEMENT_SESSION_REQUIRED',
  );
  assert.equal(expired.body.includes('Management session required'), false);
  const deniedWrite = await f.app.inject({
    method: 'POST',
    url: '/manage/orders',
    headers,
    payload: {},
  });
  assert.equal(deniedWrite.statusCode, 403);
  assert.equal(
    deniedWrite.json<{ code: string }>().code,
    'MANAGEMENT_SESSION_REQUIRED',
  );
  assert.equal(
    f.database.prepare('SELECT count(*) AS n FROM production_orders').get()?.n,
    0,
  );
  const recovered = await f.app.inject({
    method: 'POST',
    url: '/manage/session',
    headers,
  });
  assert.equal(recovered.statusCode, 200);
  const cookie = String(recovered.headers['set-cookie']).split(';')[0] ?? '';
  assert.ok(
    cookie && cookie !== headers.cookie,
    'An expired session must receive a new token',
  );
  assert.equal(
    (
      await f.app.inject({
        url: '/manage/orders',
        headers: { ...headers, cookie },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    f.database
      .prepare(
        'SELECT count(*) AS n FROM clients WHERE authorized_at IS NOT NULL',
      )
      .get()?.n,
    0,
  );
});

test('renewal rejects foreign origins, missing headers, cross-site requests and wrong authority without setting a cookie', async (t) => {
  const f = await fixture(t);
  const headers = await management(f);
  for (const changed of [
    { ...headers, origin: 'https://example.com' },
    { ...headers, origin: '' },
    { ...headers, origin: `chrome-extension://${f.extensionId}` },
    { ...headers, 'x-flow-management': '' },
    { ...headers, 'sec-fetch-site': 'cross-site' },
    { ...headers, host: 'evil.example:4319' },
    { ...headers, host: 'localhost:4319' },
  ]) {
    const response = await f.app.inject({
      method: 'POST',
      url: '/manage/session',
      headers: changed,
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(response.json<{ code?: string }>().code, undefined);
  }
  assert.equal(
    (await f.app.inject({ url: '/manage/session', headers })).statusCode,
    404,
  );
  const local = {
    host: headers.host ?? '127.0.0.1:4319',
    origin: 'http://127.0.0.1:4319',
    'x-flow-management': '1',
  };
  const started = await f.app.inject({
    method: 'POST',
    url: '/manage/session',
    headers: local,
  });
  assert.equal(started.statusCode, 200);
  assert.deepEqual(started.json(), { ok: true });
  assert.ok(started.headers['set-cookie']);
});
