// Regression tests for issues found in the code review.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { seed, DEMO_PASSWORD } from '../src/seed.js';
import { dispatchNotificationEmails } from '../src/mail.js';
import { parseServerTime } from '../../client/src/time.js';

let db;
let server;
let base;
const tokens = {};
const ids = {};
const EMAILS = {
  ceo: 'ceo@taskflow.local',
  ops: 'ops@taskflow.local',
  hoc: 'content.head@taskflow.local',
  ins1: 'instructor1@taskflow.local',
  ins2: 'instructor2@taskflow.local',
  cq: 'quality@taskflow.local',
  cs: 'cs.head@taskflow.local',
  cs1: 'support1@taskflow.local',
  po: 'product@taskflow.local',
};
const slowMailer = { enabled: true, send: () => new Promise((r) => setTimeout(r, 600)) };

async function api(who, method, path, body) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  db = openDb(':memory:');
  seed(db);
  server = createApp({ db, secret: 'qc', mailer: slowMailer, appUrl: 'https://tasks.example.com' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, email] of Object.entries(EMAILS)) {
    const { body } = await api(null, 'POST', '/auth/login', { email, password: DEMO_PASSWORD });
    tokens[k] = body.token;
    ids[k] = body.user.id;
  }
});
after(() => server.close());

test('#1 the assignee cannot skip review by removing the reviewer', async () => {
  const task = (await api('hoc', 'POST', '/tasks', { title: 'Lesson needing QA', assignee_id: ids.ins1, reviewer_id: ids.cq })).body;
  // In one request…
  const oneStep = await api('ins1', 'PATCH', `/tasks/${task.id}`, { reviewer_id: null, status: 'done' });
  assert.notEqual(oneStep.status, 200);
  // …or in two.
  assert.equal((await api('ins1', 'PATCH', `/tasks/${task.id}`, { reviewer_id: null })).status, 403);
  const after = (await api('hoc', 'GET', `/tasks/${task.id}`)).body;
  assert.equal(after.status, 'todo');
  assert.equal(after.reviewer_id, ids.cq);
  assert.equal(after.can_change_reviewer, true);
  assert.equal((await api('ins1', 'GET', `/tasks/${task.id}`)).body.can_change_reviewer, false);
  // The person who set up the review (or a manager) may still change it.
  assert.equal((await api('hoc', 'PATCH', `/tasks/${task.id}`, { reviewer_id: null })).status, 200);
  // Anyone who can edit may ask for a review on a task that has none.
  const plain = (await api('hoc', 'POST', '/tasks', { title: 'No reviewer yet', assignee_id: ids.ins1 })).body;
  assert.equal((await api('ins1', 'GET', `/tasks/${plain.id}`)).body.can_change_reviewer, true);
  assert.equal((await api('ins1', 'PATCH', `/tasks/${plain.id}`, { reviewer_id: ids.cq, status: 'in_review' })).status, 200);
  assert.equal((await api('ins1', 'PATCH', `/tasks/${plain.id}`, { reviewer_id: null })).status, 403);
  // Someone reviewing their own task (they created it) can still drop the reviewer.
  const own = (await api('ins1', 'POST', '/tasks', { title: 'My own', reviewer_id: ids.cq })).body;
  assert.equal((await api('ins1', 'PATCH', `/tasks/${own.id}`, { reviewer_id: null })).status, 200);
});

test('#2 a call-back due earlier today is due now', async () => {
  const list = (await api('cs', 'POST', '/calls/lists', { name: 'Due today', rows: [{ name: 'Early bird', phone: '1' }, { name: 'Pending one', phone: '2' }], agent_ids: [ids.cs1] })).body;
  const calls = (await api('cs', 'GET', `/calls/lists/${list.id}`)).body.calls;
  const early = calls.find((c) => c.name === 'Early bird');
  // One minute ago, in local wall-clock time as the browser sends it.
  const d = new Date(Date.now() - 60_000);
  const pad = (n) => String(n).padStart(2, '0');
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  assert.equal((await api('cs1', 'PATCH', `/calls/${early.id}`, { status: 'callback', callback_at: local })).status, 200);
  const mine = (await api('cs1', 'GET', '/calls/mine')).body.calls;
  assert.equal(mine[0].name, 'Early bird', 'a due call-back is first in the queue');
  const stats = (await api('cs', 'GET', '/calls/stats?days=1')).body.agents.find((a) => a.id === ids.cs1);
  assert.ok(stats.due >= 1);
});

test('#3 notification emails are retried when sending fails', async () => {
  db.prepare('UPDATE notifications SET emailed = 1').run();
  db.prepare("INSERT INTO notifications (user_id, type, message, params) VALUES (?, 'assigned', 'x', ?)").run(ids.po, JSON.stringify({ actor: 'A', title: 'T' }));
  let fail = true;
  const sent = [];
  const flaky = { enabled: true, send: async (m) => {
    if (fail) throw new Error('SMTP down');
    sent.push(m);
  } };
  assert.equal(await dispatchNotificationEmails(db, flaky, 'https://x', { now: 0 }), 0);
  fail = false;
  assert.equal(await dispatchNotificationEmails(db, flaky, 'https://x', { now: 10 * 60_000 }), 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'product@taskflow.local');
});

test('#4 forgot-password answers without waiting for the email to be sent', async () => {
  const start = Date.now();
  const res = await api(null, 'POST', '/auth/forgot', { email: 'marketing2@taskflow.local' });
  assert.equal(res.status, 200);
  assert.ok(Date.now() - start < 400, `took ${Date.now() - start}ms`);
});

test('#5 an admin setting a password cancels outstanding reset links', async () => {
  const target = ids.ins2;
  const link = (await api('ops', 'POST', `/users/${target}/reset-link`)).body;
  assert.equal((await api('ops', 'PATCH', `/users/${target}`, { password: 'admin-chosen-1' })).status, 200);
  const reuse = await api(null, 'POST', '/auth/reset', { token: link.token, password: 'attacker-pass' });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.body.code, 'reset_invalid');
});

test('#6 server timestamps are read as UTC; call-back times as local', () => {
  assert.equal(parseServerTime('2026-10-21 12:00:00').toISOString(), '2026-10-21T12:00:00.000Z');
  const local = parseServerTime('2026-10-21T18:30');
  assert.equal(local.getHours(), 18);
  assert.equal(local.getMinutes(), 30);
  assert.equal(parseServerTime('2026-10-21T12:00:00.000Z').toISOString(), '2026-10-21T12:00:00.000Z');
  assert.equal(parseServerTime(null), null);
});

test('#7 adding a note to a call-back call keeps its time and is not an attempt', async () => {
  const list = (await api('cs', 'POST', '/calls/lists', { name: 'Notes', rows: [{ name: 'Note me', phone: '3' }], agent_ids: [ids.cs1] })).body;
  const call = (await api('cs', 'GET', `/calls/lists/${list.id}`)).body.calls[0];
  await api('cs1', 'PATCH', `/calls/${call.id}`, { status: 'callback', callback_at: '2030-01-01T10:00' });
  const res = await api('cs1', 'PATCH', `/calls/${call.id}`, { note: 'Left a voicemail' });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'callback');
  assert.equal(res.body.callback_at, '2030-01-01T10:00');
  assert.equal(res.body.attempts, 1);
  assert.equal(res.body.notes, 'Left a voicemail');
});

test('#8 removing the project re-checks the assignee without the old project', async () => {
  // Youssef (ins2) is only assignable by the Product Owner through a shared project.
  const project = (await api('po', 'POST', '/projects', { name: 'Shared', member_ids: [ids.ins2] })).body;
  const task = (await api('po', 'POST', '/tasks', { title: 'Shared task', project_id: project.id, assignee_id: ids.po })).body;
  const res = await api('po', 'PATCH', `/tasks/${task.id}`, { project_id: null, assignee_id: ids.ins2 });
  assert.equal(res.status, 403);
  assert.equal((await api('po', 'PATCH', `/tasks/${task.id}`, { assignee_id: ids.ins2 })).status, 200);
});

test('#9 completion times use one format, so the 7-day window is exact', async () => {
  const t = (await api('ins1', 'POST', '/tasks', { title: 'Finish me' })).body;
  const done = (await api('ins1', 'PATCH', `/tasks/${t.id}`, { status: 'done' })).body;
  assert.match(done.completed_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  // Something finished 7 days and 1 hour ago is outside "done this week".
  const old = (await api('ins1', 'POST', '/tasks', { title: 'Old', status: 'done' })).body;
  assert.match(old.completed_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  db.prepare("UPDATE tasks SET completed_at = datetime('now', '-7 days', '-1 hours') WHERE id = ?").run(old.id);
  const team = (await api('hoc', 'GET', '/dashboard')).body.team;
  const nour = team.find((m) => m.id === ids.ins1);
  const expected = db
    .prepare("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status = 'done' AND completed_at >= datetime('now', '-7 days')")
    .get(ids.ins1).n;
  assert.equal(nour.done_week, expected);
  assert.ok(!db.prepare("SELECT 1 FROM tasks WHERE completed_at LIKE '%T%'").get(), 'no ISO-format completion times remain');
});

test('#10 org changes take effect immediately even with the cached hierarchy', async () => {
  // Head of Content sees instructor tasks; after moving an instructor away, they no longer do.
  const t = (await api('ins1', 'POST', '/tasks', { title: 'Private to team' })).body;
  assert.equal((await api('hoc', 'GET', `/tasks/${t.id}`)).status, 200);
  assert.equal((await api('ops', 'PATCH', `/users/${ids.ins1}`, { manager_id: ids.po })).status, 200);
  assert.equal((await api('hoc', 'GET', `/tasks/${t.id}`)).status, 404);
  assert.equal((await api('po', 'GET', `/tasks/${t.id}`)).status, 200);
});
