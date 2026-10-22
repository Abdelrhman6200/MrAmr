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
