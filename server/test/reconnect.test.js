// A hosted database closes idle connections (e.g. when it sleeps); the next
// request must still work. Needs a real Postgres server (TEST_DATABASE_URL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';

const url = process.env.TEST_DATABASE_URL;

test('queries and transactions recover when the database closed the connection', { skip: !url && 'needs TEST_DATABASE_URL' }, async () => {
  const db = await openDb({ url });
  const admin = await openDb({ url });
  try {
    await db.get('SELECT 1');
    const killAll = () => admin.run("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()");

    await killAll();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await db.get('SELECT 2 AS n')).n, 2);

    // Fill the pool, then kill every connection in it.
    await Promise.all([db.get('SELECT pg_sleep(0.05)'), db.get('SELECT pg_sleep(0.05)'), db.get('SELECT pg_sleep(0.05)')]);
    await killAll();
    await new Promise((r) => setTimeout(r, 100));
    const n = await db.tx(async (tx) => (await tx.get('SELECT 3 AS n')).n);
    assert.equal(n, 3);
    assert.equal((await db.get('SELECT 4 AS n')).n, 4);
  } finally {
    await db.close();
    await admin.close();
  }
});
