import { createApp } from './app.js';
import { openDb } from './db.js';
import { DB_FILE, PORT, STATIC_DIR, loadSecret } from './config.js';
import { seed } from './seed.js';
import { hashPassword } from './auth.js';
import { createMailer, startNotificationEmails } from './mail.js';

const db = openDb(DB_FILE);
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    // Production first run: one Head of Company account, no demo data.
    if (ADMIN_PASSWORD.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters');
    db.prepare("INSERT INTO users (name, email, password_hash, role, avatar_color) VALUES (?, ?, ?, 'ceo', '#15803d')").run(
      ADMIN_NAME || 'Administrator',
      ADMIN_EMAIL.trim().toLowerCase(),
      hashPassword(ADMIN_PASSWORD),
    );
    console.log(`Empty database — created the Head of Company account ${ADMIN_EMAIL}`);
  } else {
    seed(db);
    console.log('Empty database — loaded demo organisation (password: password123). Set ADMIN_EMAIL and ADMIN_PASSWORD to start without demo data.');
  }
}

const mailer = createMailer();
const appUrl = process.env.APP_URL || null;
if (mailer.enabled && !appUrl) console.warn('SMTP is configured but APP_URL is not: emails will have no links and password resets by email are off.');
startNotificationEmails(db, mailer, appUrl?.replace(/\/+$/, ''));

const app = createApp({ db, secret: loadSecret(), staticDir: STATIC_DIR, mailer, appUrl });
app.listen(PORT, () => console.log(`TaskFlow API listening on http://localhost:${PORT}`));
