// Leave, shifts, and the audit log.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { DEMO_PASSWORD } from '../src/seed.js';
import { localDate } from '../src/time.js';
import { testDb } from './helpers.js';

let db;
let server;
let base;

before(async () => {
  db = await testDb();
  server = createApp({ db, secret: 'test-secret' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server.close();
  await db.close();
});

async function signIn(email) {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) });
  const { token, user } = await res.json();
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { user, call };
}

test('leave: the manager approves, and a manager’s deputy then acts for them', async () => {
  const lead = await signIn('cs.lead@taskflow.local');
  const head = await signIn('cs.head@taskflow.local');
  const agent = await signIn('support3@taskflow.local');
  const other = await signIn('support1@taskflow.local');

  const asked = await lead.call('POST', '/leave', { kind: 'annual', starts_on: localDate(), ends_on: localDate(1), deputy_id: agent.user.id, note: 'Family trip' });
  assert.equal(asked.status, 201);
  assert.ok((await head.call('GET', '/notifications')).body.items.some((n) => n.type === 'leave_requested'));
  assert.equal((await other.call('POST', `/leave/${asked.body.id}/decide`, { decision: 'approve' })).status, 403);

  const pending = (await head.call('GET', '/leave')).body.team.find((l) => l.id === asked.body.id);
  assert.equal(pending.can_decide, true);
  assert.equal((await head.call('POST', `/leave/${asked.body.id}/decide`, { decision: 'approve' })).body.status, 'approved');
  assert.equal((await head.call('POST', `/leave/${asked.body.id}/decide`, { decision: 'reject' })).status, 400, 'already decided');

  // Approved with a deputy: the agent now acts for the team leader.
  assert.equal((await agent.call('GET', '/calls/stats')).status, 200);
  assert.ok((await head.call('GET', '/leave')).body.off_today.some((l) => l.id === asked.body.id));
  assert.ok((await lead.call('GET', '/notifications')).body.items.some((n) => n.type === 'leave_approved'));
  // It has started, so it can't be cancelled any more.
  assert.equal((await lead.call('DELETE', `/leave/${asked.body.id}`)).status, 400);

  const later = await other.call('POST', '/leave', { kind: 'sick', starts_on: localDate(5), ends_on: localDate(6) });
  assert.equal((await other.call('DELETE', `/leave/${later.body.id}`)).status, 204);
});

test('shifts: the manager sets them; everyone sees who is on today', async () => {
  const head = await signIn('cs.head@taskflow.local');
  const agent = await signIn('support2@taskflow.local');
  const all = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start_time: '09:00', end_time: '17:00' }));
  assert.equal((await agent.call('PUT', `/shifts/${agent.user.id}`, { shifts: all })).status, 403);
  assert.equal((await head.call('PUT', `/shifts/${agent.user.id}`, { shifts: [{ weekday: 0, start_time: '17:00', end_time: '09:00' }] })).status, 400);
  assert.equal((await head.call('PUT', `/shifts/${agent.user.id}`, { shifts: all })).status, 200);
  const view = (await agent.call('GET', '/shifts')).body;
  assert.ok(view.on_today.some((s) => s.user_id === agent.user.id));
  assert.equal(view.shifts.filter((s) => s.user_id === agent.user.id).length, 7);
});

test('the audit log records changes to people, SOPs, deputies and shifts', async () => {
  const ops = await signIn('ops@taskflow.local');
  const agent = await signIn('support1@taskflow.local');
  const hoc = await signIn('content.head@taskflow.local');
  await ops.call('PATCH', `/users/${agent.user.id}`, { title: 'Senior agent' }); // not an access change
  await ops.call('PATCH', `/users/${agent.user.id}`, { manager_id: hoc.user.id });
  await ops.call('PUT', '/sops/staffing', { steps: ['!Do it'] });
  assert.equal((await agent.call('GET', '/admin/audit')).status, 403);
  const log = (await ops.call('GET', '/admin/audit')).body;
  const userChange = log.find((e) => e.entity === 'user' && e.entity_id === agent.user.id);
  assert.ok(userChange.detail.manager_id);
  assert.ok(log.some((e) => e.entity === 'sop' && e.detail.sop === 'staffing'));
  assert.ok(log.some((e) => e.entity === 'shifts'));
  assert.ok(log.some((e) => e.entity === 'leave' && e.action === 'approved'));
});

test('performance per person, and one weekly summary per manager', async () => {
  const { sendWeeklyDigests } = await import('../src/digest.js');
  const head = await signIn('cs.head@taskflow.local');
  const agent = await signIn('support2@taskflow.local');
  const t = (await head.call('POST', '/tasks', { title: 'Quick one', assignee_id: agent.user.id, due_date: localDate(1) })).body;
  await agent.call('PATCH', `/tasks/${t.id}`, { status: 'done' });

  const kpis = (await head.call('GET', '/dashboard/kpis?days=30')).body;
  const row = kpis.people.find((p) => p.id === agent.user.id);
  assert.ok(row.done >= 1);
  assert.ok(row.on_time_pct > 0 && row.on_time_pct <= 100, 'counts the task done on time (the sample also has one done late)');
  assert.ok(!kpis.people.some((p) => p.role === 'instructor'), 'only the head’s team');
  assert.ok((await agent.call('GET', '/dashboard/kpis')).body.people.every((p) => p.id === agent.user.id));

  const first = await sendWeeklyDigests(db, localDate());
  assert.ok(first > 0);
  assert.equal(await sendWeeklyDigests(db, localDate()), 0, 'once a week');
  const note = (await head.call('GET', '/notifications')).body.items.find((n) => n.type === 'weekly_summary');
  assert.ok(note.params.done >= 1);
  assert.ok(!(await agent.call('GET', '/notifications')).body.items.some((n) => n.type === 'weekly_summary'), 'only people with a team');
});
