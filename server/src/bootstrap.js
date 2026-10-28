import { hashPassword, verifyPassword } from './auth.js';
import { setPassword } from './passwords.js';
import { bump, readCounter } from './db.js';
import { autoLoadSample, seed } from './seed.js';
import { ROLES } from './meta.js';

// First run on an empty database. With ADMIN_EMAIL and ADMIN_PASSWORD it creates
// one Head of Company account (production); otherwise, where demo data is
// allowed, it loads the demo organisation. Safe when several instances start at once.
export async function bootstrap(db, env = process.env, { allowDemo = true, autoSample = false } = {}) {
  const outcome = await firstRun(db, env, allowDemo);
  await addAccounts(db, env);
  await addDemoAccounts(db);
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
  await seed(db, { lang: env.SAMPLE_LANG }); // SAMPLE_LANG=ar: the demo in Arabic
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

// Staff accounts from the deployment's settings, for when adding them in the app
// isn't an option: ADD_ACCOUNTS holds one account per line (or separated by ;)
//   email, role, name, manager's email, title
// (role as in meta.js, e.g. marketing_member; the last three are optional) and
// ADD_ACCOUNTS_PASSWORD their first password. An account that already exists is
// left alone, so the settings can stay; remove them once everyone has signed in.
export async function addAccounts(db, env = process.env) {
  const { ADD_ACCOUNTS, ADD_ACCOUNTS_PASSWORD } = env;
  if (!ADD_ACCOUNTS) return 0;
  if (!ADD_ACCOUNTS_PASSWORD || ADD_ACCOUNTS_PASSWORD.length < 8) {
    console.warn('ADD_ACCOUNTS: set ADD_ACCOUNTS_PASSWORD (at least 8 characters) too.');
    return 0;
  }
  const rows = ADD_ACCOUNTS.split(/[;\n]/)
    .map((line) => line.split(',').map((x) => x.trim()))
    .filter(([email]) => email);
  return createAccounts(db, rows, hashPassword(ADD_ACCOUNTS_PASSWORD), 'ADD_ACCOUNTS');
}

// The company's first staff for the demo, created once if missing (an account
// that exists, or was removed after, is left alone). First password: 12345678 —
// stored scrambled; change it after signing in.
const DEMO_ACCOUNTS = [
  ['ahmedrawymahmoud@gmail.com', 'marketing_manager', 'Ahmed Rawy', 'abdelrhman.shoman62@gmail.com', 'Marketing Manager'],
  ['razanomar1515@gmail.com', 'marketing_member', 'Razan Omar', 'ahmedrawymahmoud@gmail.com', 'Marketing Coordinator'],
];
const DEMO_HASH =
  'scrypt$decd35212b19cc838ce8b67c77e0cc4a$dd13b9a02a2c7498271c8a8ea91650c38d9638636828ab58ea3168e18a3928341401f5621cde2481ca1cd0e742beb1f2574f61c0ca8338ff6024c485b8e0d59f';

export async function addDemoAccounts(db) {
  // Once per database: removing one later doesn't bring it back.
  if (await readCounter(db, 'demo_accounts')) return 0;
  // Not before the Head of Company exists: the first visitor still sets up the site.
  if (!(await db.get("SELECT 1 FROM users WHERE role = 'ceo' AND active = 1"))) return 0;
  const added = await createAccounts(db, DEMO_ACCOUNTS, DEMO_HASH, 'Demo accounts');
  await bump(db, 'demo_accounts');
  return added;
}

async function createAccounts(db, rows, hash, label) {
  let added = 0;
  for (const [rawEmail, role, name, managerEmail, title] of rows) {
    const email = rawEmail.toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !ROLES[role]) {
      console.warn(`${label}: skipped "${rawEmail}" (needs an email and a role such as marketing_member).`);
      continue;
    }
    const created = await db.tx(async (tx) => {
      if (await tx.get('SELECT 1 FROM users WHERE email = ?', [email])) return false;
      const manager = managerEmail ? await tx.get('SELECT id FROM users WHERE email = ?', [managerEmail.toLowerCase()]) : null;
      await tx.run(
        "INSERT INTO users (name, email, password_hash, role, title, manager_id, avatar_color) VALUES (?, ?, ?, ?, ?, ?, '#0ea5e9') ON CONFLICT (email) DO NOTHING",
        [name || email.split('@')[0], email, hash, role, title || ROLES[role].label, manager?.id ?? null],
      );
      await bump(tx, 'org');
      return true;
    });
    if (created) {
      added++;
      console.log(`${label}: created ${email} (${role}).`);
    }
  }
  return added;
}
