// Behaviour that matters when the API runs as several short-lived instances (Vercel).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { testDb } from './helpers.js';
import { DEMO_PASSWORD } from '../src/seed.js';
import { dispatchNotificationEmails } from '../src/mail.js';

let db;
let servers = [];
const bases = [];
const tokens = {};
const ids = {};

const EMAILS = { cs: 'cs.head@taskflow.local', cs1: 'support1@taskflow.local', cs2: 'support2@taskflow.local', ops: 'ops@taskflow.local', hoc: 'content.head@taskflow.local', ins1: 'instructor1@taskflow.local' };

async function api(who, method, path, body, base = bases[0]) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  db = await testDb();
  // Two app instances sharing one database, like two warm serverless functions.
  for (let i = 0; i < 2; i++) {
    const server = createApp({ db, secret: 'test', cronSecret: 'cron-secret' }).listen(0);
    await new Promise((r) => server.once('listening', r));
    servers.push(server);
    bases.push(`http://127.0.0.1:${server.address().port}`);
  }
  for (const [k, email] of Object.entries(EMAILS)) {
    const { body } = await api(null, 'POST', '/auth/login', { email, password: DEMO_PASSWORD });
    tokens[k] = body.token;
    ids[k] = body.user.id;
  }
});

after(async () => {
  for (const s of servers) s.close();
  await db.close();
});

const rows = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ name: `Student ${from + i + 1}`, phone: `0100${from + i}` }));

test('big call sheets can be uploaded in parts, then split between agents', async () => {
  const list = (await api('cs', 'POST', '/calls/lists', { name: 'Big sheet', rows: rows(1000) })).body;
  assert.equal(list.imported, 1000);
  const more = await api('cs', 'POST', `/calls/lists/${list.id}/rows`, { rows: [...rows(500, 1000), { name: '', phone: '' }] });
  assert.equal(more.status, 201);
  assert.deepEqual(more.body, { imported: 500, skipped: 1 });
  // Only whoever manages the list can add to it.
  assert.equal((await api('cs1', 'POST', `/calls/lists/${list.id}/rows`, { rows: rows(1) })).status, 403);
  assert.equal((await api('cs', 'POST', `/calls/lists/${list.id}/rows`, { rows: rows(1001) })).status, 400);

  const assigned = (await api('cs', 'POST', `/calls/lists/${list.id}/assign`, { agent_ids: [ids.cs1, ids.cs2] })).body;
  assert.equal(assigned.updated, 1500);
  assert.equal(assigned.assigned[ids.cs1] + assigned.assigned[ids.cs2], 1500);
  assert.ok(Math.abs(assigned.assigned[ids.cs1] - assigned.assigned[ids.cs2]) <= 1);
});

test('a list can never grow past the row limit', async () => {
  const list = (await api('cs', 'POST', '/calls/lists', { name: 'Full', rows: rows(1000) })).body;
  for (let i = 1; i < 5; i++) assert.equal((await api('cs', 'POST', `/calls/lists/${list.id}/rows`, { rows: rows(1000, i * 1000) })).status, 201);
  const over = await api('cs', 'POST', `/calls/lists/${list.id}/rows`, { rows: rows(1, 9999) });
  assert.equal(over.status, 400);
});

test('two agents claiming the same call on different instances: only one gets it', async () => {
  const list = (await api('cs', 'POST', '/calls/lists', { name: 'Race', rows: rows(1) })).body;
  const call = (await api('cs', 'GET', `/calls/lists/${list.id}`)).body.calls[0];
  const results = await Promise.all([
    api('cs1', 'PATCH', `/calls/${call.id}`, { assignee_id: ids.cs1 }, bases[0]),
    api('cs2', 'PATCH', `/calls/${call.id}`, { assignee_id: ids.cs2 }, bases[1]),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 403]);
  const owner = (await api('cs', 'GET', `/calls/${call.id}`)).body.assignee_id;
  assert.ok([ids.cs1, ids.cs2].includes(owner));
});

test('a reviewer approving twice at once completes the task once', async () => {
  const task = (await api('ins1', 'POST', '/tasks', { title: 'Race review', reviewer_id: ids.hoc, status: 'in_review' })).body;
  const results = await Promise.all([
    api('hoc', 'POST', `/tasks/${task.id}/review`, { decision: 'approve' }, bases[0]),
    api('hoc', 'POST', `/tasks/${task.id}/review`, { decision: 'approve' }, bases[1]),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
});

test('org changes made on one instance apply on the other straight away', async () => {
  const t = (await api('ins1', 'POST', '/tasks', { title: 'Visible to my manager' })).body;
  assert.equal((await api('hoc', 'GET', `/tasks/${t.id}`, null, bases[1])).status, 200);
  assert.equal((await api('ops', 'PATCH', `/users/${ids.ins1}`, { manager_id: ids.ops }, bases[0])).status, 200);
  assert.equal((await api('hoc', 'GET', `/tasks/${t.id}`, null, bases[1])).status, 404);
  assert.equal((await api('ops', 'PATCH', `/users/${ids.ins1}`, { manager_id: ids.hoc }, bases[0])).status, 200);
  assert.equal((await api('hoc', 'GET', `/tasks/${t.id}`, null, bases[1])).status, 200);
});

test('sign-in throttling is shared by every instance', async () => {
  for (let i = 0; i < 8; i++) {
    assert.equal((await api(null, 'POST', '/auth/login', { email: 'quality@taskflow.local', password: 'nope' }, bases[i % 2])).status, 401);
  }
  assert.equal((await api(null, 'POST', '/auth/login', { email: 'quality@taskflow.local', password: DEMO_PASSWORD }, bases[1])).status, 429);
});

test('notification emails are sent once even when several instances dispatch at the same time', async () => {
  await db.run('UPDATE notifications SET emailed = 1');
  for (const who of ['cs1', 'cs2', 'ins1']) {
    await db.run("INSERT INTO notifications (user_id, type, message, params) VALUES (?, 'assigned', 'x', ?)", [ids[who], JSON.stringify({ actor: 'A', title: 'T' })]);
  }
  const sent = [];
  const mailer = {
    enabled: true,
    send: async (m) => {
      await new Promise((r) => setTimeout(r, 20));
      sent.push(m.to);
    },
  };
  const counts = await Promise.all([1, 2, 3, 4].map(() => dispatchNotificationEmails(db, mailer, 'https://x')));
  assert.equal(counts.reduce((a, b) => a + b, 0), 3);
  assert.deepEqual(sent.sort(), ['instructor1@taskflow.local', 'support1@taskflow.local', 'support2@taskflow.local']);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM notifications WHERE emailed != 1')).n, 0);
});

test('a send interrupted midway is picked up again later', async () => {
  await db.run('UPDATE notifications SET emailed = 1');
  // Claimed by an instance that was frozen before it finished.
  await db.run("INSERT INTO notifications (user_id, type, message, emailed, email_claimed_at) VALUES (?, 'assigned', 'x', 2, '2000-01-01 00:00:00')", [ids.cs1]);
  const sent = [];
  const mailer = { enabled: true, send: async (m) => sent.push(m.to) };
  assert.equal(await dispatchNotificationEmails(db, mailer, null), 1);
  assert.deepEqual(sent, ['support1@taskflow.local']);
});

test('the email sweep endpoint needs the cron secret', async () => {
  assert.equal((await api(null, 'GET', '/cron/emails')).status, 401);
  const res = await fetch(`${bases[0]}/api/cron/emails`, { headers: { authorization: 'Bearer wrong' } });
  assert.equal(res.status, 401);
  const ok = await fetch(`${bases[0]}/api/cron/emails`, { headers: { authorization: 'Bearer cron-secret' } });
  assert.equal(ok.status, 200);
});

test('large request bodies are refused with a clear error, not a crash', async () => {
  const huge = { name: 'Too big', rows: [{ name: 'x'.repeat(5_000_000), phone: '1' }] };
  assert.equal((await api('cs', 'POST', '/calls/lists', huge)).status, 413);
});
