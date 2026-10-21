import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DICTS } from '../../client/src/i18n.js';

const source = fs.readFileSync(new URL('../../client/src/i18n.js', import.meta.url), 'utf8');

test('every English string has an Arabic translation', () => {
  const missing = Object.keys(DICTS.en).filter((k) => !DICTS.ar[k]);
  assert.deepEqual(missing, []);
});

test('no string key is defined twice (the later one would silently win)', () => {
  for (const name of ['en', 'ar']) {
    const body = source.split(`const ${name} = {`)[1].split('\n};')[0];
    const keys = [...body.matchAll(/^\s+['"]([^'"]+)['"]:/gm)].map((m) => m[1]);
    assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), [], `${name} has duplicate keys`);
  }
});

test('placeholders match between languages', () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const mismatched = Object.keys(DICTS.en).filter((k) => DICTS.ar[k] && vars(DICTS.en[k]).join() !== vars(DICTS.ar[k]).join());
  assert.deepEqual(mismatched, []);
});
