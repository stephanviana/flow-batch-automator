import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fixture, pair, approve, management, signed } from './support.js';

test('pairing requires explicit local approval; no terminal code or automatic approval', async (t) => {
  const f = await fixture(t);
  const receipt = await pair(f);
  assert.match(receipt.code, /^\d{6}$/);
  assert.ok(receipt.expiresAt > Date.now() + 115000);
  const before = await f.app.inject({
    method: 'POST',
    url: '/api/challenges',
    headers: f.headers,
    payload: {
      clientId: receipt.clientId,
      method: 'GET',
      target: '/api/identity',
      bodyDigest: '0'.repeat(64),
    },
  });
  assert.equal(before.statusCode, 401);
  const headers = await management(f);
  for (const modified of [
    { ...headers, cookie: '' },
    { ...headers, 'x-flow-management': '' },
    { ...headers, origin: 'https://example.com' },
    { ...headers, origin: '' },
    { ...headers, host: 'localhost:4319' },
  ]) {
    const blocked = await f.app.inject({
      method: 'POST',
      url: `/manage/requests/${receipt.requestId}`,
      headers: modified,
      payload: { approve: true },
    });
    assert.equal(blocked.statusCode, 403);
  }
  await approve(f, receipt);
  const proof = await signed(f, receipt.clientId, 'GET', '/api/identity');
  const response = await f.app.inject({
    url: '/api/identity',
    headers: proof.headers,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json<{ authorized: boolean }>().authorized, true);
});

test('expired and cancelled requests cannot approve; private JWK and mismatched extension origin rejected', async (t) => {
  const f = await fixture(t);
  const receipt = await pair(f);
  const headers = await management(f);
  f.database
    .prepare('UPDATE pairing_requests SET expires_at = 0 WHERE id = ?')
    .run(receipt.requestId);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `/manage/requests/${receipt.requestId}`,
        headers,
        payload: { approve: true },
      })
    ).statusCode,
    409,
  );
  const cancelled = await pair(f);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `/manage/requests/${cancelled.requestId}`,
        headers,
        payload: { approve: false },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `/manage/requests/${cancelled.requestId}`,
        headers,
        payload: { approve: true },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/pairing',
        headers: f.headers,
        payload: { publicKey: { ...f.publicKey, d: 'private-material' } },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/pairing',
        headers: {
          ...f.headers,
          origin: `chrome-extension://${'b'.repeat(32)}`,
        },
        payload: { publicKey: f.publicKey },
      })
    ).statusCode,
    403,
  );
});

test('concurrent replay consumes the challenge before asynchronous signature verification', async (t) => {
  const f = await fixture(t);
  const receipt = await pair(f);
  await approve(f, receipt);
  const proof = await signed(f, receipt.clientId, 'GET', '/api/identity');
  const results = await Promise.all([
    f.app.inject({ url: '/api/identity', headers: proof.headers }),
    f.app.inject({ url: '/api/identity', headers: proof.headers }),
  ]);
  assert.deepEqual(
    results.map((response) => response.statusCode).sort(),
    [200, 401],
  );
});

test('signatures bind exact body bytes, authority, path and expiry and invalid proofs are consumed', async (t) => {
  const f = await fixture(t);
  const receipt = await pair(f);
  await approve(f, receipt);
  const body = JSON.stringify({ requestId: randomUUID(), durationMs: 1000 });
  const proof = await signed(
    f,
    receipt.clientId,
    'POST',
    '/api/simulations',
    body,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/simulations',
        headers: proof.headers,
        payload: ` ${body}`,
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/simulations',
        headers: proof.headers,
        payload: body,
      })
    ).statusCode,
    401,
  );
  for (const change of ['authority', 'target', 'signature', 'expiry']) {
    const current = await signed(f, receipt.clientId, 'GET', '/api/identity');
    if (change === 'expiry')
      f.database
        .prepare('UPDATE challenges SET expires_at = 0 WHERE id = ?')
        .run(current.challenge.challengeId);
    const response = await f.app.inject({
      url: change === 'target' ? '/api/simulations' : '/api/identity',
      headers: {
        ...current.headers,
        ...(change === 'authority' ? { host: 'localhost:4319' } : {}),
        ...(change === 'signature'
          ? { 'x-flow-signature': 'A'.repeat(86) }
          : {}),
      },
    });
    assert.equal(response.statusCode, 401, change);
  }
});

test('revocation invalidates unused proofs, prevents issuing new ones and persists across reopen', async (t) => {
  const f = await fixture(t);
  const receipt = await pair(f);
  const headers = await approve(f, receipt);
  const proof = await signed(f, receipt.clientId, 'GET', '/api/identity');
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `/manage/clients/${receipt.clientId}/revoke`,
        headers,
        payload: {},
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await f.app.inject({ url: '/api/identity', headers: proof.headers }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/challenges',
        headers: f.headers,
        payload: {
          clientId: receipt.clientId,
          method: 'GET',
          target: '/api/identity',
          bodyDigest: '0'.repeat(64),
        },
      })
    ).statusCode,
    403,
  );
  assert.ok(
    f.database
      .prepare('SELECT revoked_at FROM clients WHERE id = ?')
      .get(receipt.clientId)?.revoked_at,
  );
  assert.equal(
    (
      await f.app.inject({
        url: '/api/identity',
        headers: { ...f.headers, authorization: 'Bearer anything' },
      })
    ).statusCode,
    401,
  );
});
