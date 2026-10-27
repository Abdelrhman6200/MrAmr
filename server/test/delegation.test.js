// Deputies acting for a manager (ينوب عنه), and handing someone's work over.
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

const today = localDate();
const inDays = (n) => localDate(n);

test('the sample has a Customer Service team leader and an upcoming deputy', async () => {
  const head = await signIn('cs.head@taskflow.local');
  const lead = await signIn('cs.lead@taskflow.local');
  assert.equal(lead.user.role, 'cs_team_lead');
  const list = (await head.call('GET', '/delegations')).body;
  const leave = list.find((d) => d.user_id === head.user.id);
  assert.equal(leave.deputy_id, lead.user.id);
  assert.equal(leave.active, false);
  // The team leader manages calls for her own agent.
  assert.equal((await lead.call('GET', '/calls/stats')).status, 200);
});

test('a deputy acts for the manager while the delegation lasts', async () => {
  const head = await signIn('cs.head@taskflow.local');
  const agent = await signIn('support1@taskflow.local');
  const other = await signIn('support2@taskflow.local');

  // An agent has no manager rights of their own.
  assert.equal((await agent.call('GET', '/calls/stats')).status, 403);
  assert.equal((await agent.call('POST', '/delegations', { user_id: head.user.id, deputy_id: agent.user.id, starts_on: today, ends_on: inDays(2) })).status, 403);
  assert.equal((await agent.call('POST', '/delegations', { deputy_id: other.user.id, starts_on: today, ends_on: inDays(2) })).status, 400);
  assert.equal((await head.call('POST', '/delegations', { deputy_id: agent.user.id, starts_on: inDays(-5), ends_on: inDays(-1) })).status, 400);

  const set = await head.call('POST', '/delegations', { deputy_id: agent.user.id, starts_on: today, ends_on: inDays(2), note: 'Sick leave' });
  assert.equal(set.status, 201);
  assert.equal((await head.call('POST', '/delegations', { deputy_id: other.user.id, starts_on: inDays(1), ends_on: inDays(3) })).status, 400, 'overlapping');
  assert.ok((await agent.call('GET', '/notifications')).body.items.some((n) => n.type === 'deputy_assigned'));

  // Now the agent manages calls and sees the head's team.
  assert.equal((await agent.call('GET', '/calls/stats')).status, 200);
  const team = (await agent.call('GET', '/tasks?scope=team')).body;
  assert.ok(team.some((t) => t.assignee_id === other.user.id));

  // Reviews meant for the head reach the deputy, who can decide them.
  const t = (await other.call('POST', '/tasks', { title: 'FAQ update for review', reviewer_id: head.user.id, checklist: [] })).body;
  assert.equal((await other.call('PATCH', `/tasks/${t.id}`, { status: 'in_review' })).status, 200);
  const copy = (await agent.call('GET', '/notifications')).body.items.find((n) => n.type === 'review_requested' && n.task_id === t.id);
  assert.equal(copy.params.for, head.user.id);
  assert.ok((await agent.call('GET', '/tasks?scope=review')).body.some((x) => x.id === t.id));
  assert.ok((await agent.call('GET', '/dashboard')).body.reviewQueue.some((x) => x.id === t.id));
  assert.equal((await agent.call('POST', `/tasks/${t.id}/review`, { decision: 'approve' })).status, 200);

  // Cancelled: the rights go with it.
  assert.equal((await head.call('DELETE', `/delegations/${set.body.id}`)).status, 204);
  assert.equal((await agent.call('GET', '/calls/stats')).status, 403);
});

test('a manager hands an absent agent’s open tasks and calls to a colleague', async () => {
  const head = await signIn('cs.head@taskflow.local');
  const from = await signIn('support1@taskflow.local');
  const to = await signIn('support2@taskflow.local');
  await head.call('POST', '/tasks', { title: 'Call back the Azhar group', assignee_id: from.user.id });
  const before = (await head.call('GET', `/delegations/open-work/${from.user.id}`)).body;
  assert.ok(before.tasks >= 1 && before.calls >= 1);

  assert.equal((await to.call('POST', '/delegations/handover', { from_id: from.user.id, to_id: to.user.id })).status, 403);
  const moved = await head.call('POST', '/delegations/handover', { from_id: from.user.id, to_id: to.user.id });
  assert.deepEqual(moved.body, before);
  assert.deepEqual((await head.call('GET', `/delegations/open-work/${from.user.id}`)).body, { tasks: 0, calls: 0 });
  const note = (await to.call('GET', '/notifications')).body.items.find((n) => n.type === 'handover');
  assert.equal(note.params.tasks, before.tasks);
});

test('every role has an SOP, and each team’s managers can change their roles’ SOPs', async () => {
  const { ROLE_SOPS } = await import('../../client/src/roleSops.js');
  const { ROLES } = await import('../src/meta.js');
  for (const role of Object.keys(ROLES)) {
    for (const lang of ['en', 'ar']) {
      const sop = ROLE_SOPS[role]?.[lang];
      assert.ok(sop?.purpose && sop.daily.length && sop.weekly.length && sop.system.length && sop.escalate, `${role} ${lang}`);
    }
  }

  const head = await signIn('cs.head@taskflow.local');
  const agent = await signIn('support1@taskflow.local');
  const ops = await signIn('ops@taskflow.local');
  const body = { purpose: 'Answer every student', daily: 'Call-backs first\nThen new calls', weekly: ['Clear the list'], system: 'Log every call', escalate: 'Nourhan' };
  assert.equal((await agent.call('PUT', '/sops/role/cs_member', body)).status, 403);
  assert.equal((await head.call('PUT', '/sops/role/instructor', body)).status, 403, 'another team');
  assert.equal((await head.call('PUT', '/sops/role/nobody', body)).status, 400);
  // A team leader changes their agents' and their own SOP, not their head's.
  const lead = await signIn('cs.lead@taskflow.local');
  assert.equal((await lead.call('PUT', '/sops/role/cs_head', body)).status, 403);
  assert.equal((await lead.call('PUT', '/sops/role/cs_team_lead', {})).status, 200);
  const saved = await head.call('PUT', '/sops/role/cs_member', body);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body['role:cs_member'].daily, ['Call-backs first', 'Then new calls']);
  assert.equal(saved.body['role:cs_member'].version, 1);
  assert.equal((await agent.call('GET', '/sops')).body['role:cs_member'].escalate, 'Nourhan');
  // User admins can change any role's; an empty one restores the built-in SOP.
  assert.equal((await ops.call('PUT', '/sops/role/cs_member', {})).status, 200);
  assert.equal((await agent.call('GET', '/sops')).body['role:cs_member'], undefined);
});

test('a kind of work’s SOP is changed by the department that owns it', async () => {
  const mkt = await signIn('marketing@taskflow.local');
  const po = await signIn('product@taskflow.local');
  const ops = await signIn('ops@taskflow.local');
  const steps = ['!Write the steps', 'Fix it'];
  assert.equal((await mkt.call('PUT', '/sops/bug', { steps })).status, 403);
  assert.equal((await mkt.call('PUT', '/sops/social_post', { steps })).status, 200);
  assert.equal((await po.call('PUT', '/sops/bug', { steps })).status, 200);
  assert.equal((await po.call('PUT', '/sops/general', { steps })).status, 200, 'general belongs to every manager');
  assert.equal((await ops.call('PUT', '/sops/content', { steps })).status, 200, 'operations changes any');
  for (const [who, type] of [[mkt, 'social_post'], [po, 'bug'], [po, 'general'], [ops, 'content']]) await who.call('PUT', `/sops/${type}`, { steps: [] });
});
