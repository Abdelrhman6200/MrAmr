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

test('files can be attached to a task, opened and removed', async () => {
  const po = await signIn('product@taskflow.local');
  const plat = await signIn('platform1@taskflow.local');
  const t = (await po.call('POST', '/tasks', { title: 'Complaint with a screenshot', type: 'complaint', assignee_id: plat.user.id })).body;
  const token = (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'platform1@taskflow.local', password: DEMO_PASSWORD }) })).json()).token;
  const upload = (name, type, body) =>
    fetch(`${base}/tasks/${t.id}/attachments?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body,
    });
  const bytes = Buffer.from('%PDF-1.4 fake pdf for the test');
  const up = await upload('شكوى.pdf', 'application/pdf', bytes);
  assert.equal(up.status, 201);
  const file = await up.json();
  assert.equal(file.filename, 'شكوى.pdf');

  const detail = (await po.call('GET', `/tasks/${t.id}`)).body;
  assert.equal(detail.attachments.length, 1);
  assert.equal(detail.attachment_count, 1);
  assert.equal(detail.attachments[0].data, undefined, 'the list has no file contents');

  const got = await fetch(`${base}/tasks/${t.id}/attachments/${file.id}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(got.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), bytes);

  // HTML never opens in the browser.
  const html = await (await upload('x.html', 'text/html', '<script>alert(1)</script>')).json();
  const h = await fetch(`${base}/tasks/${t.id}/attachments/${html.id}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(h.headers.get('content-type'), 'application/octet-stream');
  assert.match(h.headers.get('content-disposition'), /^attachment/);

  // Someone who can't see the task can't fetch its files.
  const ins = await signIn('instructor2@taskflow.local');
  assert.equal((await ins.call('GET', `/tasks/${t.id}/attachments/${file.id}`)).status, 404);
  assert.equal((await po.call('DELETE', `/tasks/${t.id}/attachments/${file.id}`)).status, 204);
  assert.equal((await po.call('GET', `/tasks/${t.id}`)).body.attachments.length, 1);
});

test('the Product Owner records weekly numbers; others only read them', async () => {
  const po = await signIn('product@taskflow.local');
  const cs = await signIn('cs.head@taskflow.local');
  const mkt = await signIn('marketing1@taskflow.local');

  // Any day files under its week's Saturday; blanks stay empty.
  const saved = await po.call('PUT', '/platform/stats/2026-10-21', { total_users: '1,250', active_users: 800, avg_progress: '61%', sessions: '', note: 'Unit 2 exam' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.week, '2026-10-17');
  assert.equal(saved.body.total_users, 1250);
  assert.equal(saved.body.avg_progress, 61);
  assert.equal(saved.body.sessions, null);

  const imported = await po.call('POST', '/platform/stats/import', {
    rows: [
      { week: '10/10/2026', total_users: 1200, active_users: 700 },
      { week: '2026-10-18', total_users: 1260, active_users: 820 },
      { week: 'soon', total_users: 1 },
    ],
  });
  assert.deepEqual(imported.body, { weeks: 2, skipped: 1 });

  const { weeks } = (await cs.call('GET', '/platform/stats')).body;
  assert.deepEqual(weeks.map((w) => [w.week, w.active_users]), [['2026-10-10', 700], ['2026-10-17', 820]], 'oldest first, the second import replaced the week');
  assert.equal((await cs.call('PUT', '/platform/stats/2026-10-21', { total_users: 1 })).status, 403);
  assert.equal((await mkt.call('GET', '/platform/stats')).status, 403);
});

test('course progress is imported, filtered, and behind students go to Customer Service', async () => {
  const po = await signIn('product@taskflow.local');
  const cs = await signIn('cs.head@taskflow.local');
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

  const rows = [
    { name: 'Student A', phone: '0101', progress: '0.9', last_seen: day(1) },
    { name: 'Student B', phone: '0102', progress: '0.2', last_seen: day(2) },
    { name: 'Student C', phone: '', progress: '0.1', last_seen: day(20) },
    { name: 'Student D', phone: '0104', progress: '', lessons_done: 3, lessons_total: 10, last_seen: '' },
    { name: '', phone: '0105' },
  ];
  const res = await po.call('POST', '/platform/progress/import', { course: 'Physics 3', rows });
  assert.deepEqual(res.body, { course: 'Physics 3', students: 4 });
  // Importing again replaces the course.
  await po.call('POST', '/platform/progress/import', { course: 'Physics 3', rows });

  const all = (await cs.call('GET', '/platform/progress?course=Physics%203')).body;
  assert.equal(all.total, 4);
  assert.deepEqual(all.courses.find((c) => c.course === 'Physics 3'), { ...all.courses.find((c) => c.course === 'Physics 3'), students: 4, avg_progress: 38, away_7: 2 });
  const progress = Object.fromEntries(all.students.map((s) => [s.student_name, s.progress]));
  assert.deepEqual(progress, { 'Student A': 90, 'Student B': 20, 'Student C': 10, 'Student D': 30 });

  const behind = (await cs.call('GET', '/platform/progress?course=Physics%203&below=50')).body;
  assert.deepEqual(behind.students.map((s) => s.student_name).sort(), ['Student B', 'Student C', 'Student D']);
  const away = (await cs.call('GET', '/platform/progress?course=Physics%203&inactive=7')).body;
  assert.deepEqual(away.students.map((s) => s.student_name).sort(), ['Student C', 'Student D']);

  assert.equal((await cs.call('POST', '/platform/progress/import', { course: 'X', rows })).status, 403);
  assert.equal((await po.call('POST', '/platform/progress/call-list', { course: 'Physics 3' })).status, 400, 'needs a filter');

  // Only students with a phone number are called.
  const sent = await po.call('POST', '/platform/progress/call-list', { course: 'Physics 3', below: 50 });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.calls, 2);
  const list = (await cs.call('GET', `/calls/lists/${sent.body.list_id}`)).body;
  assert.ok(list, 'Customer Service sees the list');
  const notes = (await cs.call('GET', '/notifications')).body;
  assert.ok((notes.items || notes).some((n) => n.type === 'calls_assigned' && n.link === `/calls?list=${sent.body.list_id}`));
});
