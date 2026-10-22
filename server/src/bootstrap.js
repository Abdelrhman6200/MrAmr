import { hashPassword } from './auth.js';
import { bump } from './db.js';
import { seed } from './seed.js';

// First run on an empty database. With ADMIN_EMAIL and ADMIN_PASSWORD it creates
// one Head of Company account (production); otherwise, where demo data is
// allowed, it loads the demo organisation. Safe when several instances start at once.
export async function bootstrap(db, env = process.env, { allowDemo = true } = {}) {
  if ((await db.get('SELECT COUNT(*) AS n FROM users')).n > 0) return null;
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    if (ADMIN_PASSWORD.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters');
    const created = await db.tx(async (tx) => {
      await tx.run('SELECT pg_advisory_xact_lock(4244)');
      if ((await tx.get('SELECT COUNT(*) AS n FROM users')).n > 0) return false;
      await tx.run("INSERT INTO users (name, email, password_hash, role, avatar_color) VALUES (?, ?, ?, 'ceo', '#15803d')", [
        ADMIN_NAME || 'Administrator',
        ADMIN_EMAIL.trim().toLowerCase(),
        hashPassword(ADMIN_PASSWORD),
      ]);
      await bump(tx, 'org');
      return true;
    });
    if (created) console.log(`Empty database — created the Head of Company account ${ADMIN_EMAIL}`);
    return created ? 'admin' : null;
  }
  if (!allowDemo) {
    console.warn('The database has no users. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first account.');
    return 'empty';
  }
  await seed(db);
  console.log('Empty database — loaded demo organisation (password: password123). Set ADMIN_EMAIL and ADMIN_PASSWORD to start without demo data.');
  return 'demo';
}
