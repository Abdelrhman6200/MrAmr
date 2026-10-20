import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { seed, DEMO_PASSWORD } from '../src/seed.js';

let server;
let base;
const tokens = {};
const ids = {};

async function api(who, method, path, body) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[who]}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const EMAILS = { hoc: 'content.head@taskflow.local', ops: 'ops@taskflow.local', ins1: 'instructor1@taskflow.local', ins3: 'instructor3@taskflow.local', cs1: 'support1@taskflow.local' };

before(async () => {
  const db = openDb(':memory:');
  seed(db);
  server = createApp({ db, secret: 'test' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, email] of Object.entries(EMAILS)) {
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) });
    const body = await res.json();
    tokens[k] = body.token;
    ids[k] = body.user.id;
  }
});

after(() => server.close());

test('everyone can see centers; only center admins can change them', async () => {
  const list = await api('cs1', 'GET', '/centers');
  assert.equal(list.status, 200);
  assert.ok(list.body.centers.length >= 4);
  assert.equal(list.body.can_manage, false);
  assert.equal((await api('ins1', 'POST', '/centers', { name: 'Nope' })).status, 403);
  const created = await api('ops', 'POST', '/centers', { name: 'Tagamoa Center', city: 'New Cairo', capacity: 2 });
  assert.equal(created.status, 201);
  assert.equal((await api('ops', 'POST', '/centers', { name: 'Bad', capacity: 0 })).status, 400);
});

test('opening a round notifies instructors, who submit their availability', async () => {
  const round = await api('hoc', 'POST', '/centers/rounds', { title: 'Summer camp', due_date: '2030-06-01' });
  assert.equal(round.status, 201);
  const notes = (await api('ins3', 'GET', '/notifications')).body.items;
  assert.ok(notes.some((n) => n.type === 'availability_requested' && n.params.title === 'Summer camp'));

  const bad = await api('ins3', 'PUT', `/centers/rounds/${round.body.id}/mine`, { slots: [{ day: 'sat', start: '12:00', end: '10:00' }] });
  assert.equal(bad.status, 400);
  const ok = await api('ins3', 'PUT', `/centers/rounds/${round.body.id}/mine`, { slots: [{ day: 'sat', start: '09:00', end: '13:00' }], center_ids: [1], max_sessions: 2 });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.slots, [{ day: 'sat', start: '09:00', end: '13:00' }]);

  // Admins see who submitted, can remind the rest, and can enter availability on behalf.
  const detail = (await api('hoc', 'GET', `/centers/rounds/${round.body.id}`)).body;
  assert.equal(detail.instructors.find((i) => i.id === ids.ins3).availability.max_sessions, 2);
  assert.equal((await api('ins1', 'GET', `/centers/rounds/${round.body.id}`)).status, 403);
  const remind = await api('hoc', 'POST', `/centers/rounds/${round.body.id}/remind`);
  assert.equal(remind.body.reminded, 2);
  assert.equal((await api('hoc', 'PUT', `/centers/rounds/${round.body.id}/availability/${ids.ins1}`, { slots: [] })).status, 200);

  await api('hoc', 'PATCH', `/centers/rounds/${round.body.id}`, { status: 'closed' });
  assert.equal((await api('ins3', 'PUT', `/centers/rounds/${round.body.id}/mine`, { slots: [] })).status, 400);
});

test('assignments: double-booking is blocked, availability and capacity warn unless forced', async () => {
  const round = (await api('hoc', 'POST', '/centers/rounds', { title: 'Assign test' })).body;
  await api('ins3', 'PUT', `/centers/rounds/${round.id}/mine`, { slots: [{ day: 'tue', start: '10:00', end: '18:00' }], max_sessions: 5 });
  const centers = (await api('hoc', 'GET', '/centers')).body.centers;
  const [c1, c2] = centers;
  const base = { instructor_id: ids.ins3, day: 'tue', round_id: round.id };

  assert.equal((await api('ins1', 'POST', '/centers/assignments', { ...base, center_id: c1.id, start_time: '10:00', end_time: '12:00' })).status, 403);
  const first = await api('hoc', 'POST', '/centers/assignments', { ...base, center_id: c1.id, start_time: '10:00', end_time: '12:00', subject: 'Math' });
  assert.equal(first.status, 201);

  const notes = (await api('ins3', 'GET', '/notifications')).body.items;
  assert.ok(notes.some((n) => n.type === 'center_assigned' && n.params.day === 'tue'));

  const busy = await api('hoc', 'POST', '/centers/assignments', { ...base, center_id: c2.id, start_time: '11:00', end_time: '13:00', force: true });
  assert.equal(busy.status, 409);
  assert.equal(busy.body.code, 'instructor_busy');

  const outside = await api('hoc', 'POST', '/centers/assignments', { ...base, center_id: c2.id, start_time: '18:00', end_time: '20:00' });
  assert.equal(outside.status, 409);
  assert.equal(outside.body.code, 'outside_availability');
  const forced = await api('hoc', 'POST', '/centers/assignments', { ...base, center_id: c2.id, start_time: '18:00', end_time: '20:00', force: true });
  assert.equal(forced.status, 201);

  const noSub = await api('hoc', 'POST', '/centers/assignments', { instructor_id: ids.ins1, day: 'tue', round_id: round.id, center_id: c1.id, start_time: '14:00', end_time: '15:00' });
  assert.equal(noSub.body.code, 'no_availability');

  const mine = (await api('ins3', 'GET', '/centers/assignments?instructor_id=me')).body;
  assert.equal(mine.length, 2);

  // Moving a session re-checks clashes; deleting notifies the instructor.
  const moved = await api('hoc', 'PATCH', `/centers/assignments/${forced.body.id}`, { start_time: '11:00', end_time: '12:30' });
  assert.equal(moved.body.code, 'instructor_busy');
  assert.equal((await api('hoc', 'DELETE', `/centers/assignments/${forced.body.id}`)).status, 204);
});

test('a full center warns before overbooking', async () => {
  const center = (await api('ops', 'POST', '/centers', { name: 'Tiny', capacity: 1 })).body;
  const round = (await api('hoc', 'POST', '/centers/rounds', { title: 'Capacity' })).body;
  await api('ins3', 'PUT', `/centers/rounds/${round.id}/mine`, { slots: [{ day: 'fri', start: '08:00', end: '22:00' }] });
  await api('hoc', 'PUT', `/centers/rounds/${round.id}/availability/${ids.ins1}`, { slots: [{ day: 'fri', start: '08:00', end: '22:00' }] });
  const a = await api('hoc', 'POST', '/centers/assignments', { center_id: center.id, instructor_id: ids.ins3, day: 'fri', start_time: '10:00', end_time: '12:00', round_id: round.id });
  assert.equal(a.status, 201);
  const b = await api('hoc', 'POST', '/centers/assignments', { center_id: center.id, instructor_id: ids.ins1, day: 'fri', start_time: '11:00', end_time: '13:00', round_id: round.id });
  assert.equal(b.body.code, 'center_full');
});
