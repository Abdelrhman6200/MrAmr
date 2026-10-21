import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { seed, DEMO_PASSWORD } from '../src/seed.js';
import { createLoginLimiter } from '../src/security.js';

let server;
let base;
const tokens = {};

async function call(who, method, path, body) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}
const json = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });

const EMAILS = { ceo: 'ceo@taskflow.local', ops: 'ops@taskflow.local', hoc: 'content.head@taskflow.local', cs: 'cs.head@taskflow.local', cs1: 'support1@taskflow.local' };

before(async () => {
  const db = openDb(':memory:');
  seed(db);
  server = createApp({ db, secret: 'test' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, email] of Object.entries(EMAILS)) {
    tokens[k] = (await json(await call(null, 'POST', '/auth/login', { email, password: DEMO_PASSWORD }))).body.token;
  }
});

after(() => server.close());

test('security headers are sent', async () => {
  const res = await call(null, 'GET', '/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('repeated wrong passwords lock the account for this client', async () => {
  for (let i = 0; i < 8; i++) {
    assert.equal((await call(null, 'POST', '/auth/login', { email: 'qc@taskflow.local', password: 'wrong' })).status, 401);
  }
  const locked = await json(await call(null, 'POST', '/auth/login', { email: 'qc@taskflow.local', password: DEMO_PASSWORD }));
  assert.equal(locked.status, 429);
  assert.equal(locked.body.code, 'rate_limited');
  // Other accounts are unaffected.
  assert.equal((await call(null, 'POST', '/auth/login', { email: 'product@taskflow.local', password: DEMO_PASSWORD })).status, 200);
});

test('login limiter window expires and success resets the account counter', () => {
  const lim = createLoginLimiter({ windowMs: 1000, maxPerAccount: 2, maxPerIp: 100 });
  lim.fail('1.1.1.1', 'a@x', 0);
  lim.fail('1.1.1.1', 'a@x', 10);
  assert.ok(lim.retryAfter('1.1.1.1', 'a@x', 20) > 0);
  assert.equal(lim.retryAfter('1.1.1.1', 'a@x', 2000), 0);
  lim.fail('1.1.1.1', 'b@x', 0);
  lim.succeed('1.1.1.1', 'b@x');
  lim.fail('1.1.1.1', 'b@x', 5);
  assert.equal(lim.retryAfter('1.1.1.1', 'b@x', 6), 0);
});

test('only user admins can download a backup, and it is a SQLite file', async () => {
  assert.equal((await call('hoc', 'GET', '/admin/backup')).status, 403);
  const res = await call('ops', 'GET', '/admin/backup');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /taskflow-backup-.*\.db/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 15).toString(), 'SQLite format 3');
});

test('bulk user import creates, skips duplicates, reports bad rows and resolves managers', async () => {
  assert.equal((await call('hoc', 'POST', '/users/import', { rows: [{ name: 'X', email: 'x@y.io' }], default_role: 'instructor' })).status, 403);
  const res = await json(
    await call('ops', 'POST', '/users/import', {
      default_role: 'instructor',
      rows: [
        { name: 'New Lead', email: 'lead@taskflow.local', role: 'head_of_content', manager_email: 'ops@taskflow.local' },
        { name: 'Teacher A', email: 'teacher.a@taskflow.local', manager_email: 'lead@taskflow.local' },
        { name: 'Teacher B', email: 'TEACHER.B@taskflow.local', password: 'chosenpass1' },
        { name: 'Dup', email: 'ceo@taskflow.local' },
        { name: '', email: 'noname@taskflow.local' },
        { name: 'Bad role', email: 'bad@taskflow.local', role: 'wizard' },
        { name: 'Boss', email: 'boss@taskflow.local', role: 'ceo' },
      ],
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.created, 3);
  assert.equal(res.body.skipped, 1);
  assert.equal(res.body.errors, 3);
  const [lead, a, b] = res.body.results;
  assert.ok(lead.password && lead.password.length >= 12);
  assert.equal(b.password, undefined);
  assert.equal(b.email, 'teacher.b@taskflow.local');

  const users = (await json(await call('ops', 'GET', '/users'))).body;
  const leadUser = users.find((u) => u.email === 'lead@taskflow.local');
  assert.equal(users.find((u) => u.email === 'teacher.a@taskflow.local').manager_id, leadUser.id);
  // The generated password works.
  assert.equal((await call(null, 'POST', '/auth/login', { email: a.email, password: a.password })).status, 200);
});

test('call stats are for Customer Service managers only', async () => {
  assert.equal((await call('cs1', 'GET', '/calls/stats')).status, 403);
  const res = await json(await call('cs', 'GET', '/calls/stats?days=30'));
  assert.equal(res.status, 200);
  const mohamed = res.body.agents.find((a) => a.name === 'Mohamed Gamal');
  assert.ok(mohamed.open >= 1);
  assert.ok(mohamed.logged >= 1);
});
