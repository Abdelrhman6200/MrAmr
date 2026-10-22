import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { testDb } from './helpers.js';
import { DEMO_PASSWORD } from '../src/seed.js';

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

const EMAILS = { cs: 'cs.head@taskflow.local', cs1: 'support1@taskflow.local', cs2: 'support2@taskflow.local', ins1: 'instructor1@taskflow.local', ceo: 'ceo@taskflow.local' };

before(async () => {
  const db = await testDb();
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

const rows = (n) => Array.from({ length: n }, (_, i) => ({ name: `Student ${i + 1}`, phone: `0100${i}`, data: { Name: `Student ${i + 1}`, Course: 'Physics' } }));

test('only Customer Service (and the CEO) can use calls', async () => {
  assert.equal((await api('ins1', 'GET', '/calls/lists')).status, 403);
  assert.equal((await api('cs1', 'GET', '/calls/lists')).status, 200);
  assert.equal((await api('ceo', 'GET', '/calls/lists')).status, 200);
});

test('head of CS uploads a sheet and splits it evenly between agents', async () => {
  const res = await api('cs', 'POST', '/calls/lists', { name: 'Renewals', columns: ['Name', 'Course'], rows: rows(7), agent_ids: [ids.cs1, ids.cs2] });
  assert.equal(res.status, 201);
  assert.equal(res.body.imported, 7);
  const counts = Object.values(res.body.assigned).sort();
  // Even split: 3 and 4 in some order.
  assert.deepEqual(counts, [3, 4]);

  const detail = (await api('cs', 'GET', `/calls/lists/${res.body.id}`)).body;
  assert.equal(detail.calls.length, 7);
  assert.equal(detail.calls[0].data.Course, 'Physics');

  const notes = (await api('cs1', 'GET', '/notifications')).body.items;
  assert.ok(notes.some((n) => n.type === 'calls_assigned' && n.link.includes(`list=${res.body.id}`)));
});

test('rows without name or phone are skipped', async () => {
  const res = await api('cs', 'POST', '/calls/lists', { name: 'Messy', rows: [{ name: 'A', phone: '1' }, { name: '', phone: '' }] });
  assert.equal(res.body.imported, 1);
  assert.equal(res.body.skipped, 1);
});

test('agents can upload and claim, but not assign to colleagues', async () => {
  const list = (await api('cs1', 'POST', '/calls/lists', { name: 'My list', rows: rows(3) })).body;
  assert.equal((await api('cs1', 'POST', `/calls/lists/${list.id}/assign`, { agent_ids: [ids.cs2] })).status, 403);
  const claim = await api('cs1', 'POST', `/calls/lists/${list.id}/assign`, { agent_ids: [ids.cs1] });
  assert.equal(claim.status, 200);
  assert.equal(claim.body.updated, 3);
});

test('logging outcomes: callback needs a time, attempts are counted, others cannot log', async () => {
  const list = (await api('cs', 'POST', '/calls/lists', { name: 'Outcomes', rows: rows(1), agent_ids: [ids.cs1] })).body;
  const call = (await api('cs', 'GET', `/calls/lists/${list.id}`)).body.calls[0];

  assert.equal((await api('cs2', 'PATCH', `/calls/${call.id}`, { status: 'reached' })).status, 403);
  assert.equal((await api('cs1', 'PATCH', `/calls/${call.id}`, { status: 'callback' })).status, 400);
  const cb = await api('cs1', 'PATCH', `/calls/${call.id}`, { status: 'callback', callback_at: '2030-01-01T10:00', note: 'Busy' });
  assert.equal(cb.body.status, 'callback');
  const done = await api('cs1', 'PATCH', `/calls/${call.id}`, { status: 'reached', note: 'Renewed' });
  assert.equal(done.body.attempts, 2);
  assert.equal(done.body.notes, 'Renewed');

  const detail = (await api('cs1', 'GET', `/calls/${call.id}`)).body;
  assert.equal(detail.logs.length, 2);

  const mine = (await api('cs1', 'GET', '/calls/mine?status=done')).body;
  assert.ok(mine.calls.some((c) => c.id === call.id));
});

test('users can save their language preference', async () => {
  const res = await api('cs1', 'PATCH', `/users/${ids.cs1}`, { language: 'ar' });
  assert.equal(res.body.language, 'ar');
  assert.equal((await api('cs1', 'PATCH', `/users/${ids.cs1}`, { language: 'fr' })).status, 400);
});
