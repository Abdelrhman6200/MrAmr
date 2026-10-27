// Students, homework and exams, and their marks (with barcode lookup).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { DEMO_PASSWORD } from '../src/seed.js';
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

test('the academic team records marks; others look them up or can’t see them', async () => {
  const asst = await signIn('assistant1@taskflow.local');
  const cs = await signIn('support1@taskflow.local');
  const mkt = await signIn('marketing1@taskflow.local');

  // A sheet with Arabic headers and track names; a repeated code is skipped.
  const imported = await asst.call('POST', '/grades/students/import', {
    rows: [
      { name: 'أحمد علي', code: 'B-1001', parent_phone: '0100', group_name: 'السبت 10', track: 'أزهر' },
      { name: 'سارة محمد', code: 'B-1002', group_name: 'السبت 10', track: 'عام' },
      { name: 'Omar', code: 'B-1001', group_name: 'السبت 10' },
      { name: 'منى', code: '', group_name: 'الأحد 4' },
      { name: '', code: 'B-9' },
    ],
  });
  assert.deepEqual(imported.body, { added: 3, skipped: 1 });
  const found = (await cs.call('GET', '/grades/lookup?code=B-1001')).body;
  assert.equal(found.name, 'أحمد علي');
  assert.equal(found.track, 'azhar');

  const hw = await asst.call('POST', '/grades/assessments', { title: 'Homework 5', kind: 'homework', max_mark: 10, group_name: 'السبت 10' });
  assert.equal(hw.status, 201);
  const roster = (await asst.call('GET', `/grades/assessments/${hw.body.id}`)).body.students;
  assert.deepEqual(roster.map((s) => s.name).sort(), ['أحمد علي', 'سارة محمد'].sort(), 'only the group');

  const [ahmed, sara] = ['أحمد علي', 'سارة محمد'].map((n) => roster.find((s) => s.name === n));
  assert.equal((await asst.call('PUT', `/grades/assessments/${hw.body.id}/marks/${ahmed.id}`, { mark: 11 })).status, 400, 'above full mark');
  assert.equal((await asst.call('PUT', `/grades/assessments/${hw.body.id}/marks/${ahmed.id}`, { mark: 8.5 })).status, 200);
  assert.equal((await asst.call('PUT', `/grades/assessments/${hw.body.id}/marks/${sara.id}`, { absent: true })).status, 200);
  assert.equal((await cs.call('PUT', `/grades/assessments/${hw.body.id}/marks/${sara.id}`, { mark: 10 })).status, 403, 'CS only reads');
  assert.equal((await mkt.call('GET', '/grades/students')).status, 403);

  const list = (await cs.call('GET', '/grades/assessments')).body.find((a) => a.id === hw.body.id);
  assert.equal(list.graded, 2);
  assert.equal(list.roster, 2);
  assert.equal(Number(list.average), 8.5);

  const report = (await cs.call('GET', `/grades/students/${ahmed.id}`)).body;
  assert.equal(report.marks.find((m) => m.id === hw.body.id).mark, 8.5);
  assert.equal((await cs.call('GET', '/grades/students?q=B-1001')).body.students[0].average, 85);
  // The sample students and their marks are there too.
  const sample = (await cs.call('GET', '/grades/students?q=TF-1001')).body.students[0];
  assert.ok(sample && sample.average > 0);

  // Clearing a mark removes it.
  await asst.call('PUT', `/grades/assessments/${hw.body.id}/marks/${ahmed.id}`, { mark: '' });
  assert.equal((await asst.call('GET', `/grades/assessments/${hw.body.id}`)).body.students.find((s) => s.id === ahmed.id).mark, null);
});
