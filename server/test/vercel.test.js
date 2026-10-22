// The Vercel function entry (api/index.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { testDb } from './helpers.js';

async function serve(t, handler) {
  const server = http.createServer(handler).listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('without a database the API explains what to set instead of crashing', async (t) => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  try {
    const { default: handler } = await import(`../../api/index.js?missing=${Date.now()}`);
    const base = await serve(t, handler);
    const res = await fetch(`${base}/api/index?__path=meta`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, 'server_misconfigured');
    assert.match(body.details.reason, /Storage/);
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
  }
});

test('with a database it serves the API at the rewritten path', { skip: !process.env.TEST_DATABASE_URL && 'needs TEST_DATABASE_URL' }, async (t) => {
  const saved = { ...process.env };
  // Only a database, like a fresh Vercel project with Neon connected (which sets POSTGRES_URL too).
  Object.assign(process.env, { POSTGRES_URL: process.env.TEST_DATABASE_URL, VERCEL: '1' });
  delete process.env.DATABASE_URL;
  delete process.env.AUTH_SECRET;
  await (await testDb({ withSeed: false })).close();
  t.after(() => {
    for (const k of ['DATABASE_URL', 'POSTGRES_URL', 'AUTH_SECRET', 'VERCEL', 'TRUST_PROXY']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const { default: handler } = await import(`../../api/index.js?db=${Date.now()}`);
  const base = await serve(t, handler);
  const health = await fetch(`${base}/api/index?__path=health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  const meta = await fetch(`${base}/api/index?__path=meta&x=1`);
  assert.equal(meta.status, 200);
  const m = await meta.json();
  assert.ok(m.roles.ceo);
  assert.equal(m.needsSetup, true);
  assert.equal(m.demo, false);
  assert.equal((await fetch(`${base}/api/index?__path=tasks`)).status, 401);
  // Set up the first account through the function, then use it.
  const setup = await fetch(`${base}/api/index?__path=auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Boss', email: 'boss@x.io', password: 'longenough1' }),
  });
  assert.equal(setup.status, 201);
  const { token } = await setup.json();
  const tasks = await fetch(`${base}/api/index?__path=tasks`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(tasks.status, 200);
  // The template data was loaded for them without any button.
  assert.ok((await tasks.json()).length > 20);
  const dash = await (await fetch(`${base}/api/index?__path=dashboard`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.ok(Object.values(dash.counts).reduce((a, b) => a + b, 0) >= 5);
});
