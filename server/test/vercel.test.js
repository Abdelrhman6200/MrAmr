// The Vercel function entry (api/index.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

async function serve(t, handler) {
  const server = http.createServer(handler).listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('without DATABASE_URL the API explains what to set instead of crashing', async (t) => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const { default: handler } = await import(`../../api/index.js?missing=${Date.now()}`);
    const base = await serve(t, handler);
    const res = await fetch(`${base}/api/index?__path=meta`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, 'server_misconfigured');
    assert.match(body.details.reason, /DATABASE_URL/);
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
  }
});

test('with a database it serves the API at the rewritten path', { skip: !process.env.TEST_DATABASE_URL && 'needs TEST_DATABASE_URL' }, async (t) => {
  const saved = { ...process.env };
  Object.assign(process.env, { DATABASE_URL: process.env.TEST_DATABASE_URL, AUTH_SECRET: 'x'.repeat(32), VERCEL: '1' });
  t.after(() => {
    for (const k of ['DATABASE_URL', 'AUTH_SECRET', 'VERCEL', 'TRUST_PROXY']) {
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
  assert.ok((await meta.json()).roles.ceo);
  assert.equal((await fetch(`${base}/api/index?__path=tasks`)).status, 401);
});
