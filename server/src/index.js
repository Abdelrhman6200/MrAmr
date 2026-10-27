// Long-running server: local development or any Node host.
// (On Vercel, api/index.js serves the API instead.)
import { createApp } from './app.js';
import { databaseUrl, openDb } from './db.js';
import { PORT, STATIC_DIR, corsOrigins, loadSecret, localDataDir } from './config.js';
import { bootstrap } from './bootstrap.js';
import { createMailer, startNotificationEmails } from './mail.js';

const db = await openDb({ dataDir: databaseUrl() ? undefined : localDataDir() });
await bootstrap(db);

const mailer = createMailer();
const appUrl = process.env.APP_URL || null;
if (mailer.enabled && !appUrl) console.warn('SMTP is configured but APP_URL is not: emails will have no links and password resets by email are off.');

const app = createApp({ db, secret: loadSecret(), staticDir: STATIC_DIR, mailer, appUrl, corsOrigins: corsOrigins(), cronSecret: process.env.CRON_SECRET, digests: true });
startNotificationEmails(app.locals.dispatchEmails, mailer);
app.listen(PORT, () => console.log(`TaskFlow API listening on http://localhost:${PORT} (${db.kind === 'postgres' ? 'Postgres' : 'built-in database'})`));
