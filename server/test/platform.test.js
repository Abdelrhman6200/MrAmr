// The online platform: content upload schedule, exams, forums and complaints.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { DEMO_PASSWORD, upgradeSample } from '../src/seed.js';
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

test('the sample platform team has its schedule, exams, forums and complaints', async () => {
  const po = await signIn('product@taskflow.local');
  const uploads = (await po.call('GET', '/tasks?type=content_upload')).body;
  assert.ok(uploads.length >= 12);
  assert.ok(uploads.some((x) => x.status === 'done') && uploads.some((x) => x.status === 'todo'));
  const mixed = (await po.call('GET', '/tasks?type=platform_exam,exam_results')).body;
  assert.ok(mixed.some((x) => x.type === 'platform_exam') && mixed.some((x) => x.type === 'exam_results'));
  assert.ok((await po.call('GET', '/tasks?type=complaint')).body.length >= 4);
  assert.ok((await po.call('GET', '/tasks?type=forum_moderation')).body.length >= 2);
});

test('a content plan becomes one upload task per item, each with the SOP', async () => {
  const po = await signIn('product@taskflow.local');
  const member = (await po.call('GET', '/users')).body.find((u) => u.email === 'platform1@taskflow.local');
  const items = ['Lesson 9: Light', 'Lesson 10: Lenses', 'Unit 3 exam'].map((title, i) => ({ title, due_date: `2026-11-${String(7 + i * 7).padStart(2, '0')}` }));
  const res = await po.call('POST', '/tasks/batch', { type: 'content_upload', assignee_id: member.id, track: ['azhar', 'general'], items });
  assert.equal(res.status, 201);
  assert.equal(res.body.ids.length, 3);
  const created = await Promise.all(res.body.ids.map(async (id) => (await po.call('GET', `/tasks/${id}`)).body));
  assert.deepEqual(created.map((x) => [x.title, x.due_date]), items.map((i) => [i.title, i.due_date]));
  assert.ok(created.every((x) => x.track === 'general,azhar' && x.assignee_id === member.id && x.checklist.length === 7));

  const plat = await signIn('platform1@taskflow.local');
  assert.ok((await plat.call('GET', '/notifications')).body.items.some((n) => n.type === 'assigned' && n.params.title === 'Lesson 9: Light (+2)'));

  assert.equal((await po.call('POST', '/tasks/batch', { items: [] })).status, 400);
  assert.equal((await po.call('POST', '/tasks/batch', { items: [{ title: 'x', due_date: 'soon' }] })).status, 400);
  // The same assignment rules as single tasks.
  const ins = (await po.call('GET', '/users')).body.find((u) => u.email === 'instructor2@taskflow.local');
  assert.equal((await plat.call('POST', '/tasks/batch', { assignee_id: ins.id, items: [{ title: 'x' }] })).status, 403);
});

test('a site that loaded the sample before gets the platform team added once', async () => {
  const people = (await db.all("SELECT id FROM users WHERE role = 'platform_member'")).map((u) => u.id);
  await db.run('DELETE FROM tasks WHERE assignee_id = ANY(?::int[]) OR project_id IN (SELECT id FROM projects WHERE name = ?)', [people, 'Online platform — Term 1']);
  await db.run("DELETE FROM projects WHERE name = 'Online platform — Term 1'");
  await db.run('DELETE FROM notifications WHERE user_id = ANY(?::int[])', [people]);
  await db.run('DELETE FROM users WHERE id = ANY(?::int[])', [people]);
  await db.run("DELETE FROM app_state WHERE key = 'sample_platform'");

  assert.equal(await upgradeSample(db), true);
  assert.equal(await upgradeSample(db), false);
  const po = await db.get("SELECT id FROM users WHERE email = 'product@taskflow.local'");
  assert.deepEqual((await db.all("SELECT manager_id FROM users WHERE role = 'platform_member'")).map((u) => u.manager_id), [po.id, po.id]);
});
