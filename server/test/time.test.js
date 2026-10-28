// The app's time zone, whatever the host sets TZ to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTimeZone } from '../src/time.js';

test('the time zone falls back to Cairo when the host only says UTC', () => {
  assert.equal(pickTimeZone({ TZ: ':UTC' }), 'Africa/Cairo', 'Vercel');
  assert.equal(pickTimeZone({ TZ: 'UTC' }), 'Africa/Cairo');
  assert.equal(pickTimeZone({}), 'Africa/Cairo');
  assert.equal(pickTimeZone({ TZ: 'Asia/Dubai' }), 'Asia/Dubai');
  assert.equal(pickTimeZone({ APP_TIMEZONE: 'UTC', TZ: ':UTC' }), 'UTC', 'asked for on purpose');
  assert.equal(pickTimeZone({ APP_TIMEZONE: 'Nowhere/Land' }), 'Africa/Cairo');
  assert.equal(pickTimeZone({ TZ: ':Europe/Berlin' }), 'Europe/Berlin');
});
