// First run on an empty database: the first visitor creates the Head of Company.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { storedSecret } from '../src/db.js';
import { testDb } from './helpers.js';

let db;
let server;
let base;

before(async () => {
  db = await testDb({ withSeed: false });
  server = createApp({ db, secret: 'test' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server.close();
  await db.close();
});

const post = async (path, body) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('an empty database asks for the first account, once', async () => {
  assert.equal((await (await fetch(`${base}/meta`)).json()).needsSetup, true);
  assert.equal((await post('/auth/setup', { name: 'Boss', email: 'boss@x.io', password: 'short' })).status, 400);

  // Two people racing to set up: exactly one wins.
  const [a, b] = await Promise.all([
    post('/auth/setup', { name: 'Boss', email: 'Boss@X.io', password: 'longenough1', language: 'ar' }),
    post('/auth/setup', { name: 'Other', email: 'other@x.io', password: 'longenough2' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const winner = a.status === 201 ? a.body : b.body;
  assert.equal(winner.user.role, 'ceo');

  const me = await fetch(`${base}/auth/me`, { headers: { authorization: `Bearer ${winner.token}` } });
  assert.equal(me.status, 200);
  assert.equal((await (await fetch(`${base}/meta`)).json()).needsSetup, false);
  assert.equal((await post('/auth/setup', { name: 'Late', email: 'late@x.io', password: 'longenough3' })).status, 409);
});

test('the generated session key is created once and shared', async () => {
  const [k1, k2] = await Promise.all([storedSecret(db, 'auth'), storedSecret(db, 'auth')]);
  assert.equal(k1, k2);
  assert.equal(k1.length, 64);
  assert.equal(await storedSecret(db, 'auth'), k1);
});

test('the Head of Company can load sample data under their account and remove it again', async () => {
  const boss = await post('/auth/login', { email: 'boss@x.io', password: 'longenough1' }).then((r) => (r.status === 200 ? r : null));
  const owner = boss ?? (await post('/auth/login', { email: 'other@x.io', password: 'longenough2' }));
  const auth = { authorization: `Bearer ${owner.body.token}`, 'content-type': 'application/json' };
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: auth, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  // Some real work before and after loading the sample.
  const real = (await call('POST', '/tasks', { title: 'Real task' })).body;
  assert.equal((await call('POST', '/admin/sample')).status, 201);
  assert.equal((await call('POST', '/admin/sample')).status, 409);
  assert.equal((await (await fetch(`${base}/meta`)).json()).sampleData, true);

  const users = (await call('GET', '/users')).body;
  assert.equal(users.filter((u) => u.role === 'ceo').length, 1, 'the sample team reports to the real Head of Company');
  const ops = users.find((u) => u.email === 'ops@taskflow.local');
  assert.equal(ops.manager_id, owner.body.user.id);
  // Sample accounts can't be signed into with the published demo password.
  assert.equal((await post('/auth/login', { email: 'ops@taskflow.local', password: 'password123' })).status, 401);
  assert.ok((await call('GET', '/tasks')).body.length > 20);
  assert.ok((await call('GET', '/calls/lists')).body.lists.length >= 1);

  // Real work that involves sample people.
  const project = (await call('POST', '/projects', { name: 'Real project', member_ids: [ops.id] })).body;
  const assigned = (await call('POST', '/tasks', { title: 'Real, for Lina', assignee_id: ops.id, project_id: project.id })).body;

  const removed = await call('DELETE', '/admin/sample');
  assert.equal(removed.status, 200);
  assert.ok(removed.body.removed > 50);
  const after = (await call('GET', '/users')).body;
  assert.equal(after.length, 1);
  const tasks = (await call('GET', '/tasks')).body.map((t) => t.title).sort();
  assert.deepEqual(tasks, ['Real task', 'Real, for Lina'].sort());
  assert.equal((await call('GET', `/tasks/${assigned.id}`)).body.assignee_id, null);
  assert.equal((await call('GET', `/tasks/${real.id}`)).status, 200);
  assert.equal((await call('GET', '/calls/lists')).body.lists.length, 0);
  assert.equal((await call('GET', '/centers')).body.centers.length, 0);
  assert.equal((await (await fetch(`${base}/meta`)).json()).sampleData, false);

  // And it can be loaded again afterwards.
  assert.equal((await call('POST', '/admin/sample')).status, 201);
});

test('a locked-out admin can set a new password from the deployment settings', async () => {
  const { bootstrap } = await import('../src/bootstrap.js');
  const email = (await db.get("SELECT email FROM users WHERE role = 'ceo' LIMIT 1")).email;
  // Without ADMIN_RESET nothing changes.
  await bootstrap(db, { ADMIN_EMAIL: email, ADMIN_PASSWORD: 'recovered-pass-1' });
  assert.equal((await post('/auth/login', { email, password: 'recovered-pass-1' })).status, 401);
  await bootstrap(db, { ADMIN_RESET: '1', ADMIN_EMAIL: email, ADMIN_PASSWORD: 'recovered-pass-1' });
  const ok = await post('/auth/login', { email, password: 'recovered-pass-1' });
  assert.equal(ok.status, 200);
  // Running again with the same settings keeps the new sign-in working.
  await bootstrap(db, { ADMIN_RESET: '1', ADMIN_EMAIL: email, ADMIN_PASSWORD: 'recovered-pass-1' });
  assert.equal((await fetch(`${base}/auth/me`, { headers: { authorization: `Bearer ${ok.body.token}` } })).status, 200);
});

test('ADMIN_RESET creates the account when it does not exist', async () => {
  const { bootstrap } = await import('../src/bootstrap.js');
  await bootstrap(db, { ADMIN_RESET: '1', ADMIN_EMAIL: 'New.Boss@x.io', ADMIN_PASSWORD: 'another-pass-1' });
  const res = await post('/auth/login', { email: 'new.boss@x.io', password: 'another-pass-1' });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, 'ceo');
});

test('the sample loads by itself once, and stays removed after removal', async () => {
  const { autoLoadSample, hasSampleData, removeSampleData } = await import('../src/seed.js');
  const ceo = await db.get("SELECT * FROM users WHERE role = 'ceo' ORDER BY id LIMIT 1");
  if (await hasSampleData(db)) await removeSampleData(db, ceo);
  await db.run("DELETE FROM app_state WHERE key = 'sample_auto'");
  const runs = await Promise.all([autoLoadSample(db, 'new.boss@x.io'), autoLoadSample(db, 'new.boss@x.io')]);
  assert.deepEqual(runs.sort(), [false, true]);
  assert.equal(await hasSampleData(db), true);
  // Built under the preferred Head of Company.
  const boss = await db.get("SELECT id FROM users WHERE email = 'new.boss@x.io'");
  assert.equal((await db.get("SELECT manager_id FROM users WHERE email = 'ops@taskflow.local'")).manager_id, boss.id);
  await removeSampleData(db, boss);
  assert.equal(await autoLoadSample(db, 'new.boss@x.io'), false);
  assert.equal(await hasSampleData(db), false);
});

test('an interrupted automatic load leaves nothing behind and is retried', async () => {
  const { autoLoadSample, hasSampleData, removeSampleData, readStatus } = await import('../src/seed.js');
  const ceo = await db.get("SELECT * FROM users WHERE role = 'ceo' ORDER BY id LIMIT 1");
  if (await hasSampleData(db)) await removeSampleData(db, ceo);
  await db.run("DELETE FROM app_state WHERE key = 'sample_auto'");
  // Simulate the server being stopped part-way: the insert of the tasks fails.
  // (In either language: the sample follows the Head of Company's.)
  await db.run("ALTER TABLE tasks ADD CONSTRAINT block_sample CHECK (title NOT IN ('Q4 budget review', 'مراجعة ميزانية الربع الرابع'))");
  await assert.rejects(autoLoadSample(db, ceo.email));
  assert.equal(await hasSampleData(db), false);
  assert.match(await readStatus(db, 'sample'), /^failed/);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@taskflow.local'")).n, 0);
  await db.run('ALTER TABLE tasks DROP CONSTRAINT block_sample');
  // The next attempt (next start, or the Head of Company opening the dashboard) works.
  assert.equal(await autoLoadSample(db, ceo.email), true);
  assert.match(await readStatus(db, 'sample'), /^loaded under/);
  // In the Head of Company's language.
  const lang = ceo.language === 'ar' ? 'ar' : 'en';
  const title = lang === 'ar' ? 'مراجعة ميزانية الربع الرابع' : 'Q4 budget review';
  assert.ok(await db.get('SELECT 1 FROM tasks WHERE title = ?', [title]));
});

test('a load the previous version marked done but never finished is retried', async () => {
  const { autoLoadSample, hasSampleData, removeSampleData } = await import('../src/seed.js');
  const ceo = await db.get("SELECT * FROM users WHERE role = 'ceo' ORDER BY id LIMIT 1");
  if (await hasSampleData(db)) await removeSampleData(db, ceo);
  // What the old code could leave: the mark set, no data, no outcome noted.
  await db.run("INSERT INTO app_state (key, value) VALUES ('sample_auto', 1) ON CONFLICT (key) DO UPDATE SET value = 1");
  await db.run("DELETE FROM app_secrets WHERE key = 'status:sample'");
  assert.equal(await autoLoadSample(db, ceo.email), true);
  assert.equal(await hasSampleData(db), true);
  // After a removal it stays removed.
  await removeSampleData(db, ceo);
  assert.equal(await autoLoadSample(db, ceo.email), false);
});

test('ADD_ACCOUNTS creates staff accounts once, with their role and manager', async () => {
  const { addAccounts } = await import('../src/bootstrap.js');
  const env = {
    ADD_ACCOUNTS: 'Boss.Mkt@x.io, marketing_manager, Ahmed Rawy; coord@x.io, marketing_member, Razan Omar, boss.mkt@x.io, Marketing Coordinator\nbad-line, nobody',
    ADD_ACCOUNTS_PASSWORD: 'first-pass-1',
  };
  assert.equal(await addAccounts(db, { ADD_ACCOUNTS: env.ADD_ACCOUNTS, ADD_ACCOUNTS_PASSWORD: 'short' }), 0);
  assert.equal(await addAccounts(db, env), 2);
  assert.equal(await addAccounts(db, env), 0, 'already there');
  const coord = await db.get('SELECT u.*, m.email AS manager_email FROM users u LEFT JOIN users m ON m.id = u.manager_id WHERE u.email = ?', ['coord@x.io']);
  assert.equal(coord.role, 'marketing_member');
  assert.equal(coord.title, 'Marketing Coordinator');
  assert.equal(coord.manager_email, 'boss.mkt@x.io');
  const login = await post('/auth/login', { email: 'coord@x.io', password: 'first-pass-1' });
  assert.equal(login.status, 200);
});
