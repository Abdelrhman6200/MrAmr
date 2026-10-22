import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { seed, DEMO_PASSWORD } from '../src/seed.js';

let server;
let base;
before(async () => {
  const db = openDb(':memory:');
  seed(db);
  server = createApp({ db, secret: 't', corsOrigins: ['https://tasks.example.com', 'https://taskflow-*.vercel.app'] }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const preflight = (origin) =>
  fetch(`${base}/api/auth/login`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });

test('the configured web app may call the API', async () => {
  const pre = await preflight('https://tasks.example.com');
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://tasks.example.com');
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);

  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { origin: 'https://tasks.example.com', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ops@taskflow.local', password: DEMO_PASSWORD }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://tasks.example.com');
  assert.match(res.headers.get('access-control-expose-headers'), /Content-Disposition/);
});

test('Vercel preview addresses match the pattern, look-alikes do not', async () => {
  assert.equal((await preflight('https://taskflow-git-main-team.vercel.app')).status, 204);
  assert.equal((await preflight('https://taskflow-x.vercel.app.evil.com')).status, 403);
  assert.equal((await preflight('https://evil.com/taskflow-x.vercel.app')).status, 403);
  assert.equal((await preflight('https://other.vercel.app')).status, 403);
});

test('other sites get no CORS permission', async () => {
  const res = await fetch(`${base}/api/health`, { headers: { origin: 'https://attacker.example' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});
