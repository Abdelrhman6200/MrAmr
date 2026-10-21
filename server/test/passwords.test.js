import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { seed, DEMO_PASSWORD } from '../src/seed.js';
import { createMailer, dispatchNotificationEmails } from '../src/mail.js';

const outbox = [];
const fakeMailer = { enabled: true, send: async (msg) => outbox.push(msg) };
let db;
let base;
let server;

async function call(method, path, body, token) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const login = async (email, password = DEMO_PASSWORD) => (await call('POST', '/auth/login', { email, password })).body.token;
const tokenFrom = (text) => /token=([\w-]+)/.exec(text)[1];

before(async () => {
  db = openDb(':memory:');
  seed(db);
  server = createApp({ db, secret: 'test', mailer: fakeMailer, appUrl: 'https://tasks.example.com/' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('email is off without SMTP settings', () => {
  assert.equal(createMailer({}).enabled, false);
});

test('forgot password emails a single-use link built from APP_URL, never from the request', async () => {
  outbox.length = 0;
  const res = await fetch(`${base}/api/auth/forgot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'evil.example' },
    body: JSON.stringify({ email: 'instructor2@taskflow.local' }),
  });
  assert.equal(res.status, 200);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, 'instructor2@taskflow.local');
  assert.match(outbox[0].text, /^.*https:\/\/tasks\.example\.com\/reset\?token=/m);
  assert.doesNotMatch(outbox[0].html, /evil\.example/);

  const token = tokenFrom(outbox[0].text);
  const oldSession = await login('instructor2@taskflow.local');
  assert.equal((await call('GET', `/auth/reset/${token}`)).body.email, 'instructor2@taskflow.local');
  assert.equal((await call('POST', '/auth/reset', { token, password: 'short' })).status, 400);
  const done = await call('POST', '/auth/reset', { token, password: 'brand-new-pass' });
  assert.equal(done.status, 200);
  assert.ok(done.body.token);

  // Single use, old sessions signed out, new password works.
  assert.equal((await call('POST', '/auth/reset', { token, password: 'another-pass' })).body.code, 'reset_invalid');
  assert.equal((await call('GET', '/auth/me', null, oldSession)).status, 401);
  assert.equal((await call('GET', '/auth/me', null, done.body.token)).status, 200);
  assert.ok(await login('instructor2@taskflow.local', 'brand-new-pass'));
});

test('forgot password does not reveal whether an account exists', async () => {
  outbox.length = 0;
  const known = await call('POST', '/auth/forgot', { email: 'qc@taskflow.local' });
  const unknown = await call('POST', '/auth/forgot', { email: 'nobody@taskflow.local' });
  assert.deepEqual(known.body, unknown.body);
  assert.equal(outbox.length, 1);
});

test('changing your password keeps this session and signs out the others', async () => {
  const a = await login('marketing1@taskflow.local');
  const b = await login('marketing1@taskflow.local');
  const res = await call('POST', '/auth/change-password', { currentPassword: DEMO_PASSWORD, newPassword: 'fresh-password-1' }, a);
  assert.equal(res.status, 200);
  assert.equal((await call('GET', '/auth/me', null, res.body.token)).status, 200);
  assert.equal((await call('GET', '/auth/me', null, a)).status, 401);
  assert.equal((await call('GET', '/auth/me', null, b)).status, 401);
});

test('admins can create a reset link; others cannot', async () => {
  const ops = await login('ops@taskflow.local');
  const hoc = await login('content.head@taskflow.local');
  const target = (await call('GET', '/users', null, ops)).body.find((u) => u.email === 'support2@taskflow.local');
  assert.equal((await call('POST', `/users/${target.id}/reset-link`, {}, hoc)).status, 403);
  const link = await call('POST', `/users/${target.id}/reset-link`, {}, ops);
  assert.equal(link.status, 200);
  assert.equal(link.body.hours, 72);
  assert.equal((await call('POST', '/auth/reset', { token: link.body.token, password: 'from-admin-link' })).status, 200);
  const ceo = (await call('GET', '/users', null, ops)).body.find((u) => u.role === 'ceo');
  assert.equal((await call('POST', `/users/${ceo.id}/reset-link`, {}, ops)).status, 403);
});

test('notification emails: one per person, in their language, respecting opt-out', async () => {
  outbox.length = 0;
  db.prepare('UPDATE notifications SET emailed = 1').run();
  const ids = Object.fromEntries(db.prepare('SELECT email, id FROM users').all().map((u) => [u.email, u.id]));
  db.prepare("UPDATE users SET language = 'ar' WHERE id = ?").run(ids['instructor1@taskflow.local']);
  db.prepare('UPDATE users SET email_notifications = 0 WHERE id = ?').run(ids['instructor3@taskflow.local']);
  const ins = db.prepare('INSERT INTO notifications (user_id, type, message, task_id, link, params) VALUES (?, ?, ?, ?, ?, ?)');
  ins.run(ids['instructor1@taskflow.local'], 'assigned', 'X assigned you "A"', 1, null, JSON.stringify({ actor: 'Karim', title: 'A' }));
  ins.run(ids['instructor1@taskflow.local'], 'center_assigned', 'fallback', null, '/centers?tab=mine', JSON.stringify({ actor: 'Karim', center: 'Maadi', day: 'tue', start: '10:00', end: '12:00' }));
  ins.run(ids['instructor3@taskflow.local'], 'assigned', 'X assigned you "B"', 2, null, JSON.stringify({ actor: 'Karim', title: 'B' }));

  assert.equal(await dispatchNotificationEmails(db, fakeMailer, 'https://tasks.example.com'), 1);
  assert.equal(outbox.length, 1);
  const mail = outbox[0];
  assert.equal(mail.to, 'instructor1@taskflow.local');
  assert.match(mail.subject, /2 إشعار جديد/);
  assert.match(mail.text, /أسند إليك Karim مهمة "A"/);
  assert.match(mail.text, /يوم الثلاثاء/);
  assert.match(mail.text, /https:\/\/tasks\.example\.com\/\?task=1/);
  assert.match(mail.html, /dir="rtl"/);

  // Everything is marked as handled, so nothing is sent twice.
  assert.equal(await dispatchNotificationEmails(db, fakeMailer, 'https://tasks.example.com'), 0);
});

test('users can turn notification emails off for themselves', async () => {
  const token = await login('product@taskflow.local');
  const me = (await call('GET', '/auth/me', null, token)).body.user;
  assert.equal(me.email_notifications, true);
  const res = await call('PATCH', `/users/${me.id}`, { email_notifications: false }, token);
  assert.equal(res.body.email_notifications, false);
});
