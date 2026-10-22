import { hashPassword, verifyPassword } from './auth.js';
import { setPassword } from './passwords.js';
import { bump } from './db.js';
import { autoLoadSample, seed } from './seed.js';

// First run on an empty database. With ADMIN_EMAIL and ADMIN_PASSWORD it creates
// one Head of Company account (production); otherwise, where demo data is
// allowed, it loads the demo organisation. Safe when several instances start at once.
export async function bootstrap(db, env = process.env, { allowDemo = true, autoSample = false } = {}) {
  const outcome = await firstRun(db, env, allowDemo);
  // Template data for trying the app, loaded once without anyone clicking anything.
  if (autoSample) {
    try {
      await autoLoadSample(db, env.ADMIN_EMAIL);
    } catch (err) {
      console.error('Loading the sample data failed:', err);
    }
  }
  return outcome;
}

async function firstRun(db, env, allowDemo) {
  if ((await db.get('SELECT COUNT(*) AS n FROM users')).n > 0 || env.ADMIN_RESET === '1') {
    await recoverAdmin(db, env);
    if ((await db.get('SELECT COUNT(*) AS n FROM users')).n > 0) return null;
  }
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

// Locked out with no email set up (or the account doesn't exist): set ADMIN_RESET=1 with ADMIN_EMAIL and ADMIN_PASSWORD,
// redeploy, sign in with that password, then remove the three settings.
// Only someone who can change the deployment's settings can do this.
async function recoverAdmin(db, env) {
  const { ADMIN_RESET, ADMIN_EMAIL, ADMIN_PASSWORD } = env;
  if (ADMIN_RESET !== '1' || !ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  if (ADMIN_PASSWORD.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters');
  const email = ADMIN_EMAIL.trim().toLowerCase();
  const user = await db.get('SELECT id, password_hash FROM users WHERE email = ?', [email]);
  if (!user) {
    // No such account yet: create it as a Head of Company.
    await db.tx(async (tx) => {
      await tx.run(
        "INSERT INTO users (name, email, password_hash, role, avatar_color) VALUES (?, ?, ?, 'ceo', '#15803d') ON CONFLICT (email) DO NOTHING",
        [env.ADMIN_NAME || email.split('@')[0], email, hashPassword(ADMIN_PASSWORD)],
      );
      await bump(tx, 'org');
    });
    return console.log(`ADMIN_RESET: created the Head of Company account ${email}. Remove ADMIN_RESET from the settings now.`);
  }
  // Already set: don't sign people out again on every start.
  if (verifyPassword(ADMIN_PASSWORD, user.password_hash)) return;
  await setPassword(db, user.id, ADMIN_PASSWORD);
  await db.run('UPDATE users SET active = 1 WHERE id = ?', [user.id]);
  console.log(`ADMIN_RESET: set a new password for ${ADMIN_EMAIL}. Remove ADMIN_RESET from the settings now.`);
}
