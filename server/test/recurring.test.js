// Recurring tasks: one task per day, week or month, with the type's SOP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { DEMO_PASSWORD } from '../src/seed.js';
import { ensureRecurring, periodOf } from '../src/weekly.js';
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

test('periods: daily skips Fridays, weekly is due on its weekday, monthly on its day', () => {
  assert.deepEqual(periodOf({ frequency: 'daily' }, '2026-10-27'), { key: '2026-10-27', due: '2026-10-27' });
  assert.equal(periodOf({ frequency: 'daily' }, '2026-10-30'), null); // Friday
  assert.deepEqual(periodOf({ frequency: 'weekly', weekday: 2 }, '2026-10-27'), { key: '2026-10-24', due: '2026-10-26' });
  assert.deepEqual(periodOf({ frequency: 'monthly', month_day: 31 }, '2026-11-05'), { key: '2026-11', due: '2026-11-30' });
});

test('a recurring task makes one task per period, with its SOP', async () => {
  const po = await signIn('product@taskflow.local');
  const plat = await signIn('platform2@taskflow.local');
  const ins = await signIn('instructor1@taskflow.local');

  // The same assignment rules as tasks.
  assert.equal((await ins.call('POST', '/recurring', { title: 'x', frequency: 'daily', assignee_id: plat.user.id })).status, 403);

  const made = await po.call('POST', '/recurring', { title: 'Forum moderation', type: 'forum_moderation', frequency: 'weekly', weekday: 4, assignee_id: plat.user.id, reviewer_id: po.user.id });
  assert.equal(made.status, 201);
  const id = made.body.id;
  const tasks = async () => (await plat.call('GET', '/tasks?type=forum_moderation&scope=mine')).body.filter((t) => t.recurring_id === id);
  const first = await tasks();
  assert.equal(first.length, 1, 'this week’s straight away');
  const detail = (await plat.call('GET', `/tasks/${first[0].id}`)).body;
  assert.equal(detail.checklist.length, 6);
  assert.equal(detail.reviewer_id, po.user.id);
  assert.ok((await plat.call('GET', '/notifications')).body.items.some((n) => n.type === 'recurring_task'));

  assert.equal(await ensureRecurring(db), 0, 'nothing new in the same week');
  assert.equal(await ensureRecurring(db, '2030-01-05'), 1, 'a later week gets its own');
  assert.equal((await tasks()).length, 2);

  // Paused: no more.
  assert.equal((await po.call('PATCH', `/recurring/${id}`, { active: false })).status, 200);
  assert.equal(await ensureRecurring(db, '2030-01-12'), 0);
  const list = (await plat.call('GET', '/recurring')).body;
  assert.equal(list.find((r) => r.id === id).can_manage, false, 'the assignee doesn’t manage it');

  // Deleting stops it; the tasks stay.
  assert.equal((await po.call('DELETE', `/recurring/${id}`)).status, 204);
  assert.equal((await plat.call('GET', `/tasks/${first[0].id}`)).status, 200);
});
