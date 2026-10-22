// A fresh, seeded database for a test file: PGlite in memory, or the Postgres
// server in TEST_DATABASE_URL (emptied first; run those with --test-concurrency=1).
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';

export async function testDb({ withSeed = true } = {}) {
  const url = process.env.TEST_DATABASE_URL || '';
  const db = await openDb({ url });
  if (url) {
    const tables = await db.all("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'app_state'");
    await db.run(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  if (withSeed) await seed(db);
  return db;
}
