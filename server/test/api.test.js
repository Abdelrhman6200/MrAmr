import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { testDb } from './helpers.js';
import { DEMO_PASSWORD } from '../src/seed.js';
import { ROLES } from '../src/meta.js';

let db;
let server;
let base;
const tokens = {};

async function api(who, method, path, body) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const EMAILS = {
  ceo: 'ceo@taskflow.local',
  ops: 'ops@taskflow.local',
  hoc: 'content.head@taskflow.local',
  ins1: 'instructor1@taskflow.local',
  ins2: 'instructor2@taskflow.local',
  cq: 'quality@taskflow.local',
  mkt1: 'marketing1@taskflow.local',
  cs1: 'support1@taskflow.local',
  po: 'product@taskflow.local',
};
const ids = {};

before(async () => {
  db = await testDb();
  server = createApp({ db, secret: 'test-secret' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, email] of Object.entries(EMAILS)) {
    const { body } = await api(null, 'POST', '/auth/login', { email, password: DEMO_PASSWORD });
    tokens[k] = body.token;
    ids[k] = body.user.id;
  }
});

after(async () => {
  server.close();
  await db.close();
});

test('login rejects bad credentials and unauthenticated requests', async () => {
  assert.equal((await api(null, 'POST', '/auth/login', { email: EMAILS.ceo, password: 'nope' })).status, 401);
  assert.equal((await api(null, 'GET', '/tasks')).status, 401);
});

test('CEO sees every task; an instructor only sees their own scope', async () => {
  const all = (await api('ceo', 'GET', '/tasks')).body;
  const mine = (await api('ins2', 'GET', '/tasks')).body;
  assert.ok(all.length > mine.length);
  // Instructor 2 is not in the marketing project, so cannot see marketing-only tasks.
  assert.ok(!mine.some((t) => t.title === 'Launch paid ads'));
  // ...but sees tasks in the Physics project they belong to.
  assert.ok(mine.some((t) => t.title === 'Record Lesson 2: Newton’s Laws'));
});

test('managers see their whole reporting line', async () => {
  const opsTasks = (await api('ops', 'GET', '/tasks?scope=team')).body;
  // Operations Manager -> Head of Content -> Instructors
  assert.ok(opsTasks.some((t) => t.assignee_id === ids.ins1));
  const marketingHidden = (await api('ops', 'GET', '/tasks')).body;
  assert.ok(!marketingHidden.some((t) => t.title === 'Design social media creatives'));
});

test('hidden tasks return 404, not 403', async () => {
  const ads = (await api('ceo', 'GET', '/tasks')).body.find((t) => t.title === 'Launch paid ads');
  assert.equal((await api('ins2', 'GET', `/tasks/${ads.id}`)).status, 404);
});

test('assignment rules: members can assign to managers but not to unrelated peers', async () => {
  const toManager = await api('cs1', 'POST', '/tasks', { title: 'Students report broken quiz', type: 'bug', assignee_id: ids.po });
  assert.equal(toManager.status, 201);
  const toPeer = await api('cs1', 'POST', '/tasks', { title: 'Peer task', assignee_id: ids.mkt1 });
  assert.equal(toPeer.status, 403);
  const hocToInstructor = await api('hoc', 'POST', '/tasks', { title: 'Record bonus lesson', assignee_id: ids.ins2 });
  assert.equal(hocToInstructor.status, 201);
});

test('content review workflow: in_review -> changes -> approve', async () => {
  const created = await api('hoc', 'POST', '/tasks', {
    title: 'Record Lesson 9',
    type: 'content',
    assignee_id: ids.ins1,
    reviewer_id: ids.ops,
  });
  assert.equal(created.status, 201);
  const id = created.body.id;

  // Assignee cannot skip review.
  assert.equal((await api('ins1', 'PATCH', `/tasks/${id}`, { status: 'done' })).status, 400);
  // The content SOP's required steps come first.
  const early = await api('ins1', 'PATCH', `/tasks/${id}`, { status: 'in_review' });
  assert.equal(early.status, 400);
  assert.equal(early.body.code, 'required_steps');
  assert.equal(early.body.details.steps[0], 'Write the script and get it approved by the Head of Content');
  const { checklist } = (await api('ins1', 'GET', `/tasks/${id}`)).body;
  // The assignee can't delete a required step to get past it.
  assert.equal((await api('ins1', 'DELETE', `/tasks/${id}/checklist/${checklist[0].id}`)).status, 403);
  for (const c of checklist.filter((c) => c.required)) await api('ins1', 'PATCH', `/tasks/${id}/checklist/${c.id}`, { done: true });
  assert.equal((await api('ins1', 'PATCH', `/tasks/${id}`, { status: 'in_review' })).status, 200);

  // Assignee cannot approve their own work.
  assert.equal((await api('ins1', 'POST', `/tasks/${id}/review`, { decision: 'approve' })).status, 403);

  // Reviewer requests changes (needs a comment).
  assert.equal((await api('ops', 'POST', `/tasks/${id}/review`, { decision: 'changes' })).status, 400);
  const changes = await api('ops', 'POST', `/tasks/${id}/review`, { decision: 'changes', comment: 'Captions are off by one slide' });
  assert.equal(changes.body.status, 'in_progress');

  const notes = (await api('ins1', 'GET', '/notifications')).body.items;
  assert.ok(notes.some((n) => n.type === 'changes_requested' && n.task_id === id));

  await api('ins1', 'PATCH', `/tasks/${id}`, { status: 'in_review' });
  const approved = await api('ops', 'POST', `/tasks/${id}/review`, { decision: 'approve' });
  assert.equal(approved.body.status, 'done');
  assert.ok(approved.body.completed_at);
});

test('sending to review requires a reviewer', async () => {
  const t = (await api('ins1', 'POST', '/tasks', { title: 'Solo task' })).body;
  assert.equal((await api('ins1', 'PATCH', `/tasks/${t.id}`, { status: 'in_review' })).status, 400);
  assert.equal((await api('ins1', 'PATCH', `/tasks/${t.id}`, { status: 'done' })).status, 200);
});

test('only managers create projects; only admins create users', async () => {
  assert.equal((await api('ins1', 'POST', '/projects', { name: 'Nope' })).status, 403);
  const p = await api('hoc', 'POST', '/projects', { name: 'Chemistry 101', member_ids: [ids.ins2] });
  assert.equal(p.status, 201);
  assert.equal(p.body.department, 'content');
  assert.ok(p.body.members.some((m) => m.id === ids.ins2));

  assert.equal((await api('hoc', 'POST', '/users', { name: 'X', email: 'x@x.io', role: 'instructor', password: 'longenough' })).status, 403);
  const u = await api('ops', 'POST', '/users', { name: 'New Instructor', email: 'new@taskflow.local', role: 'instructor', manager_id: ids.hoc, password: 'longenough' });
  assert.equal(u.status, 201);
  assert.equal((await api('ops', 'POST', '/users', { name: 'Boss', email: 'b@taskflow.local', role: 'ceo', password: 'longenough' })).status, 403);
});

test('reporting loops are rejected', async () => {
  const res = await api('ceo', 'PATCH', `/users/${ids.ops}`, { manager_id: ids.ins1 });
  assert.equal(res.status, 400);
});

test('checklist, comments and dashboard', async () => {
  const t = (await api('ins2', 'POST', '/tasks', { title: 'Checklist task', checklist: ['one', 'two'] })).body;
  const detail = (await api('ins2', 'GET', `/tasks/${t.id}`)).body;
  assert.equal(detail.checklist.length, 2);
  await api('ins2', 'PATCH', `/tasks/${t.id}/checklist/${detail.checklist[0].id}`, { done: true });
  const c = await api('hoc', 'POST', `/tasks/${t.id}/comments`, { body: 'Looks good' });
  assert.equal(c.status, 201);
  const after = (await api('ins2', 'GET', `/tasks/${t.id}`)).body;
  assert.equal(after.checklist_done, 1);
  assert.equal(after.comments.length, 1);

  const dash = (await api('hoc', 'GET', '/dashboard')).body;
  assert.ok(Array.isArray(dash.team) && dash.team.length >= 3);
  const reports = (await api('ceo', 'GET', '/dashboard/reports')).body;
  assert.ok(reports.byDepartment.length >= 5);
});

test('review comments are written in the reviewer’s language', async () => {
  const t = (await api('ins1', 'POST', '/tasks', { title: 'Arabic review', reviewer_id: ids.ops, status: 'in_review' })).body;
  assert.equal((await api('ops', 'PATCH', `/users/${ids.ops}`, { language: 'ar' })).status, 200);
  assert.equal((await api('ops', 'POST', `/tasks/${t.id}/review`, { decision: 'changes', comment: 'أضف مثالًا' })).status, 200);
  const detail = (await api('ins1', 'GET', `/tasks/${t.id}`)).body;
  assert.equal(detail.comments.at(-1).body, '🔁 مطلوب تعديلات: أضف مثالًا');
  await api('ops', 'PATCH', `/users/${ids.ops}`, { language: 'en' });
});

test('only a manager can review a task', async () => {
  // A team member can't be the reviewer, on a new task or a changed one…
  assert.equal((await api('hoc', 'POST', '/tasks', { title: 'Peer review', assignee_id: ids.ins1, reviewer_id: ids.cq })).status, 400);
  const t = (await api('hoc', 'POST', '/tasks', { title: 'Needs a manager', assignee_id: ids.ins1 })).body;
  const bad = await api('hoc', 'PATCH', `/tasks/${t.id}`, { reviewer_id: ids.ins2 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'Only a manager can review a task');
  // …a manager can, in any team.
  assert.equal((await api('hoc', 'PATCH', `/tasks/${t.id}`, { reviewer_id: ids.ops })).status, 200);
  // A task that already had a member as its reviewer can still be edited.
  await db.run('UPDATE tasks SET reviewer_id = ? WHERE id = ?', [ids.cq, t.id]);
  assert.equal((await api('hoc', 'PATCH', `/tasks/${t.id}`, { priority: 'high' })).status, 200);

  // The pick list is the managers.
  const list = (await api('ins1', 'GET', '/users/reviewers')).body;
  assert.ok(list.length >= 5 && list.every((u) => ROLES[u.role].level !== 'member'));
  assert.ok(list.some((u) => u.id === ids.hoc) && list.some((u) => u.id === ids.ceo) && !list.some((u) => u.id === ids.ins2));
});

test('each team sees its own team alone; leadership and the Operations Manager see everyone', async () => {
  const everyone = (await api('ceo', 'GET', '/users')).body;
  assert.ok(everyone.some((u) => u.role === 'cs_head') && everyone.some((u) => u.role === 'instructor') && everyone.some((u) => u.role === 'product_owner'));
  assert.equal((await api('ops', 'GET', '/users')).body.length, everyone.length);

  const dept = (people, d) => people.every((u) => u.department === d);
  const mine = (await api('ins1', 'GET', '/users')).body;
  assert.ok(mine.length >= 4 && dept(mine, 'content'), 'an instructor sees the content team only');
  assert.ok(mine.some((u) => u.id === ids.hoc) && mine.some((u) => u.id === ids.ins2));
  const cs = (await api('cs1', 'GET', '/users')).body;
  assert.ok(cs.length >= 4 && dept(cs, 'customer_service'));
  const mkt = (await api('mkt1', 'GET', '/users')).body;
  assert.ok(dept(mkt, 'marketing'));

  // A person's page is the same: another team's member isn't found, your own team's is.
  assert.equal((await api('ins1', 'GET', `/users/${ids.cs1}`)).status, 404);
  assert.equal((await api('ins1', 'GET', `/users/${ids.ins2}`)).status, 200);
  assert.equal((await api('ins1', 'GET', `/users/${ids.ins1}`)).status, 200);
  assert.equal((await api('ceo', 'GET', `/users/${ids.cs1}`)).status, 200);
});
