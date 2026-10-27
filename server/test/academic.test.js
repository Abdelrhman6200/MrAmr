// The Academic Material team: work types, tracks and the assistants' weekly duties.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { DEMO_PASSWORD, upgradeSample } from '../src/seed.js';
import { ensureWeeklyDuties, weekStart } from '../src/weekly.js';
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

async function signIn(email, password = DEMO_PASSWORD) {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const { token, user } = await res.json();
  const call = async (method, path, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { user, call };
}

test('weeks start on Saturday', () => {
  assert.equal(weekStart('2026-10-24'), '2026-10-24'); // Saturday
  assert.equal(weekStart('2026-10-25'), '2026-10-24');
  assert.equal(weekStart('2026-10-30'), '2026-10-24'); // Friday
  assert.equal(weekStart('2026-10-31'), '2026-10-31');
});

test('each assistant gets this week’s duties once, reviewed by their manager', async () => {
  const head = await signIn('academic.head@taskflow.local');
  const asst = await signIn('assistant1@taskflow.local');
  const mine = (await asst.call('GET', '/tasks?scope=mine&type=weekly_duties')).body;
  const week = weekStart();
  const current = mine.filter((t) => t.weekly_key === week);
  assert.equal(current.length, 1);
  assert.equal(mine.length, 2, 'last week’s (sample) and this week’s');

  const detail = (await asst.call('GET', `/tasks/${current[0].id}`)).body;
  assert.equal(detail.reviewer_id, head.user.id);
  assert.equal(detail.checklist.length, 6);
  assert.equal(detail.checklist[5].text, 'Attend the class');
  assert.equal(detail.start_date, week);
  assert.ok(detail.due_date > week);

  // Running again (another instance, the daily cron) adds nothing.
  assert.equal(await ensureWeeklyDuties(db), 0);
  const notes = (await asst.call('GET', '/notifications')).body.items;
  assert.equal(notes.filter((n) => n.type === 'weekly_duties').length, 1);

  // The assistant can't finish it alone: the head approves it.
  assert.equal((await asst.call('PATCH', `/tasks/${detail.id}`, { status: 'done' })).status, 400);
});

test('a new assistant gets their duties straight away, in their language', async () => {
  const ops = await signIn('ops@taskflow.local');
  const head = await signIn('academic.head@taskflow.local');
  const created = await ops.call('POST', '/users', {
    name: 'Omnia Adel',
    email: 'assistant4@taskflow.local',
    role: 'assistant',
    manager_id: head.user.id,
    password: 'longenough',
  });
  assert.equal(created.status, 201);
  const asst = await signIn('assistant4@taskflow.local', 'longenough');
  assert.equal((await asst.call('GET', '/tasks?scope=mine&type=weekly_duties')).body.length, 1);

  assert.equal((await asst.call('PATCH', `/users/${asst.user.id}`, { language: 'ar' })).status, 200);
  assert.equal(await ensureWeeklyDuties(db, '2026-12-05'), 4); // all four assistants
  const next = (await asst.call('GET', '/tasks?scope=mine&type=weekly_duties')).body.find((t) => t.weekly_key === '2026-12-05');
  assert.equal(next.title, 'المهام الأسبوعية — أسبوع 2026-12-05');
  assert.equal(next.due_date, '2026-12-11');
  const detail = (await asst.call('GET', `/tasks/${next.id}`)).body;
  assert.equal(detail.checklist[3].text, 'حل كتاب المستر');
});

test('tasks have an optional track and can be filtered by it', async () => {
  const head = await signIn('academic.head@taskflow.local');
  const asst = (await head.call('GET', '/users')).body.find((u) => u.email === 'assistant2@taskflow.local');
  const t = await head.call('POST', '/tasks', { title: 'Proctor the Azhar exam', type: 'exam_proctoring', track: 'azhar', assignee_id: asst.id });
  assert.equal(t.status, 201);
  assert.equal(t.body.track, 'azhar');
  assert.equal((await head.call('POST', '/tasks', { title: 'Bad', track: 'medicine' })).status, 400);
  assert.equal((await head.call('PATCH', `/tasks/${t.body.id}`, { track: 'baccalaureate' })).body.track, 'baccalaureate');

  const bac = (await head.call('GET', '/tasks?track=baccalaureate')).body;
  assert.ok(bac.length >= 3);
  assert.ok(bac.every((x) => x.track === 'baccalaureate'));
  const meta = await (await fetch(`${base}/meta`)).json();
  assert.deepEqual(meta.tracks.map((x) => x.key), ['general', 'azhar', 'baccalaureate']);
  assert.ok(meta.taskTypes.some((x) => x.key === 'essay_grading' && x.group === 'academic'));
});

test('a site that loaded the sample before gets the academic team added once', async () => {
  // Make the database look like one seeded before the team existed.
  const people = (await db.all("SELECT id FROM users WHERE role IN ('academic_head', 'assistant')")).map((u) => u.id);
  await db.run('DELETE FROM tasks WHERE assignee_id = ANY(?::int[]) OR reporter_id = ANY(?::int[])', [people, people]);
  await db.run("DELETE FROM projects WHERE department = 'academic'");
  await db.run('DELETE FROM users WHERE id = ANY(?::int[])', [people]);
  await db.run("DELETE FROM app_state WHERE key = 'sample_academic'");

  const [a, b] = await Promise.all([upgradeSample(db), upgradeSample(db)]);
  assert.deepEqual([a, b].sort(), [false, true]);
  assert.equal(await upgradeSample(db), false);
  const head = await db.get("SELECT u.id, m.role AS manager_role FROM users u JOIN users m ON m.id = u.manager_id WHERE u.email = 'academic.head@taskflow.local'");
  assert.equal(head.manager_role, 'ceo');
  assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM users WHERE role = 'assistant'")).n, 3);
  // Same password scheme as the rest of the sample (the demo one here).
  assert.equal((await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'assistant3@taskflow.local', password: DEMO_PASSWORD }) })).status, 200);
});

test('a task can have several tracks, and filters match any of them', async () => {
  const head = await signIn('academic.head@taskflow.local');
  const t = await head.call('POST', '/tasks', { title: 'Model answer for both', type: 'hw_model_answer', track: ['azhar', 'general'] });
  assert.equal(t.body.track, 'general,azhar');
  assert.equal((await head.call('PATCH', `/tasks/${t.body.id}`, { track: 'azhar,azhar' })).body.track, 'azhar');
  await head.call('PATCH', `/tasks/${t.body.id}`, { track: 'general,azhar' });
  for (const track of ['general', 'azhar']) {
    assert.ok((await head.call('GET', `/tasks?track=${track}`)).body.some((x) => x.id === t.body.id));
  }
  assert.ok(!(await head.call('GET', '/tasks?track=baccalaureate')).body.some((x) => x.id === t.body.id));
});

test('new tasks start with their type’s SOP, which the responsible managers can change', async () => {
  const head = await signIn('academic.head@taskflow.local');
  const asst = await signIn('assistant1@taskflow.local');
  const cs = await signIn('cs.head@taskflow.local');
  const ceo = await signIn('ceo@taskflow.local');
  const checklist = async (who, body) => {
    const t = (await who.call('POST', '/tasks', body)).body;
    return (await who.call('GET', `/tasks/${t.id}`)).body.checklist.map((c) => (c.required ? `!${c.text}` : c.text));
  };

  assert.equal((await checklist(asst, { title: 'Proctor', type: 'exam_proctoring' }))[0], '!Go into the exam hall before the start');
  // An explicit checklist (even an empty one) wins.
  assert.deepEqual(await checklist(asst, { title: 'Proctor 2', type: 'exam_proctoring', checklist: [] }), []);

  assert.equal((await asst.call('PUT', '/sops/exam_proctoring', { steps: ['x'] })).status, 403);
  assert.equal((await cs.call('PUT', '/sops/exam_proctoring', { steps: ['x'] })).status, 403, 'not their team’s work');
  assert.equal((await cs.call('PUT', '/sops/support', { steps: ['Greet the student', ' ', 'Solve it'] })).status, 200);
  const saved = await head.call('PUT', '/sops/exam_proctoring', { target: 'At the hall by 9:30', steps: [{ text: 'Be there at 9:30', required: true }, 'Count the papers'] });
  assert.deepEqual(saved.body.exam_proctoring.steps, [{ text: 'Be there at 9:30', required: true }, { text: 'Count the papers', required: false }]);
  assert.equal(saved.body.exam_proctoring.target, 'At the hall by 9:30');
  assert.equal(saved.body.exam_proctoring.version, 1);
  assert.equal((await head.call('PUT', '/sops/exam_proctoring', { steps: ['!Be there at 9:30', 'Count the papers'] })).body.exam_proctoring.version, 2);
  assert.equal(saved.body.support.steps.length, 2);
  assert.deepEqual(await checklist(asst, { title: 'Proctor 3', type: 'exam_proctoring' }), ['!Be there at 9:30', 'Count the papers']);

  // Back to the built-in steps, in the creator's language.
  assert.equal((await ceo.call('PUT', '/sops/exam_proctoring', { steps: [] })).status, 200);
  assert.equal((await asst.call('GET', '/sops')).body.exam_proctoring, undefined);
  await asst.call('PATCH', `/users/${asst.user.id}`, { language: 'ar' });
  assert.equal((await checklist(asst, { title: 'مراقبة', type: 'exam_proctoring' }))[0], '!ادخل القاعة قبل بداية الامتحان');

  // A task with an empty checklist can take its SOP's steps later.
  const bare = (await asst.call('POST', '/tasks', { title: 'Bare', type: 'exam_grading', checklist: [] })).body;
  assert.equal((await asst.call('POST', `/tasks/${bare.id}/checklist/sop`)).status, 201);
  const steps = (await asst.call('GET', `/tasks/${bare.id}`)).body.checklist;
  assert.equal(steps.length, 6);
  assert.equal(steps.filter((c) => c.required).length, 3);

  // Usage over the tasks the user can see.
  const stats = (await head.call('GET', '/sops/stats')).body;
  assert.ok(stats.exam_proctoring.used >= 4);
  assert.ok(stats.hw_grading.used >= 2 && stats.hw_grading.done_with_date >= 1);
  await asst.call('PATCH', `/users/${asst.user.id}`, { language: 'en' });
});
