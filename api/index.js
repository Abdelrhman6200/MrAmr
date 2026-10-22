// Vercel serverless entry: every /api/* request is routed here (see vercel.json).
// The app is created once per warm instance and reused across requests.
import { createApp } from '../server/src/app.js';
import { openDb } from '../server/src/db.js';
import { corsOrigins, loadSecret } from '../server/src/config.js';
import { bootstrap } from '../server/src/bootstrap.js';
import { createMailer } from '../server/src/mail.js';

// A deployment setting is missing or wrong; the message is shown on the sign-in screen.
class SetupError extends Error {}

const setting = (fn) => {
  try {
    return fn();
  } catch (err) {
    throw new SetupError(err.message);
  }
};

// Explains a failed database connection without echoing the error itself: it can
// contain pieces of a malformed DATABASE_URL, password included.
function databaseProblem(err) {
  if (err.message.startsWith('DATABASE_URL')) return err.message;
  // Supabase's direct address (db.<ref>.supabase.co) is IPv6-only, which Vercel can't reach.
  if (/@db\.[a-z0-9]+\.supabase\.co/.test(process.env.DATABASE_URL)) {
    return 'DATABASE_URL is Supabase\'s direct connection, which Vercel cannot reach. Use the Transaction pooler connection string (port 6543).';
  }
  const reasons = {
    ENOTFOUND: 'the database address in DATABASE_URL was not found',
    ECONNREFUSED: 'the database refused the connection (check the port: 6543 for the Transaction pooler)',
    ETIMEDOUT: 'the database did not answer in time',
    '28P01': 'the database password in DATABASE_URL is wrong',
    '28000': 'the database user in DATABASE_URL was not accepted',
    '3D000': 'the database name in DATABASE_URL does not exist',
    XX000: 'the database pooler rejected the connection (check the user name, e.g. postgres.<project-ref>)',
  };
  return `Could not connect to the database: ${reasons[err.code] || 'see the Functions logs in Vercel for details'}.`;
}

let ready;

async function init() {
  if (!process.env.DATABASE_URL) {
    throw new SetupError('DATABASE_URL is not set. Add your Supabase connection string (Transaction pooler) in the Vercel project settings.');
  }
  const secret = setting(loadSecret);
  process.env.TRUST_PROXY ||= '1'; // Vercel's edge sets X-Forwarded-For to the real client address
  let db;
  try {
    db = await openDb();
  } catch (err) {
    console.error(err);
    throw new SetupError(databaseProblem(err));
  }
  try {
    // Demo data only when asked for: a fresh production database waits for ADMIN_EMAIL/ADMIN_PASSWORD.
    const outcome = await bootstrap(db, process.env, { allowDemo: process.env.DEMO_DATA === '1' });
    if (outcome === 'empty') throw new SetupError('ADMIN_EMAIL and ADMIN_PASSWORD are not set, so there is no account to sign in with yet.');
  } catch (err) {
    await db.close().catch(() => {});
    throw err instanceof SetupError || !err.message.startsWith('ADMIN_') ? err : new SetupError(err.message);
  }
  return createApp({
    db,
    secret,
    mailer: createMailer(),
    appUrl: process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null),
    corsOrigins: corsOrigins(),
    cronSecret: process.env.CRON_SECRET,
  });
}

export default async function handler(req, res) {
  try {
    ready ??= init();
    const app = await ready;
    // The rewrite sends /api/<path> here as ?__path=<path>; restore the original URL for Express.
    const url = new URL(req.url, 'http://localhost');
    const path = url.searchParams.get('__path');
    if (path !== null) {
      url.searchParams.delete('__path');
      req.url = `/api/${path}${url.search}`;
    }
    return app(req, res);
  } catch (err) {
    ready = undefined; // try again on the next request
    console.error(err);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    const reason = err instanceof SetupError ? err.message : 'The server failed to start — see the Functions logs in Vercel.';
    res.end(JSON.stringify({ error: 'The server is not configured yet', code: 'server_misconfigured', details: { reason } }));
  }
}
