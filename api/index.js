// Vercel serverless entry: every /api/* request is routed here (see vercel.json).
// The app is created once per warm instance and reused across requests.
//
// The only thing it needs is a Postgres database: add one from the project's
// Storage tab in Vercel and it sets DATABASE_URL (or POSTGRES_URL) for us.
// The session-signing key is generated and kept in the database, and the first
// Head of Company account is created from the sign-in page.
import { createApp } from '../server/src/app.js';
import { databaseUrl, openDb, storedSecret } from '../server/src/db.js';
import { corsOrigins } from '../server/src/config.js';
import { bootstrap } from '../server/src/bootstrap.js';
import { createMailer } from '../server/src/mail.js';

// A deployment setting is missing or wrong; the message is shown on the sign-in screen.
class SetupError extends Error {}

// Explains a failed database connection without echoing the error itself: it can
// contain pieces of a malformed connection string, password included.
function databaseProblem(err) {
  if (err.message.startsWith('DATABASE_URL')) return err.message;
  // Supabase's direct address (db.<ref>.supabase.co) is IPv6-only, which Vercel can't reach.
  if (/@db\.[a-z0-9]+\.supabase\.co/.test(databaseUrl())) {
    return "DATABASE_URL is Supabase's direct connection, which Vercel cannot reach. Use the Transaction pooler connection string (port 6543).";
  }
  const reasons = {
    ENOTFOUND: 'the database address was not found',
    ECONNREFUSED: 'the database refused the connection',
    ETIMEDOUT: 'the database did not answer in time',
    '28P01': 'the database password is wrong',
    '28000': 'the database user was not accepted',
    '3D000': 'the database does not exist',
    XX000: 'the database pooler rejected the connection',
  };
  return `Could not connect to the database: ${reasons[err.code] || 'see the Functions logs in Vercel for details'}.`;
}

let ready;

async function init() {
  if (!databaseUrl()) {
    throw new SetupError('No database is connected. In Vercel open this project → Storage → Create Database (Neon Postgres), connect it to the project, then redeploy.');
  }
  process.env.TRUST_PROXY ||= '1'; // Vercel's edge sets X-Forwarded-For to the real client address
  let db;
  try {
    db = await openDb();
  } catch (err) {
    console.error(err);
    throw new SetupError(databaseProblem(err));
  }
  try {
    // Optional: ADMIN_EMAIL/ADMIN_PASSWORD create the first account; otherwise the sign-in
    // page asks for it. Demo data only when asked for with DEMO_DATA=1.
    // The sample team and tasks load once by themselves (SAMPLE_DATA=0 turns that off).
    await bootstrap(db, process.env, { allowDemo: process.env.DEMO_DATA === '1', autoSample: process.env.SAMPLE_DATA !== '0' });
  } catch (err) {
    await db.close().catch(() => {});
    throw err.message.startsWith('ADMIN_') ? new SetupError(err.message) : err;
  }
  return createApp({
    db,
    secret: process.env.AUTH_SECRET || (await storedSecret(db, 'auth')),
    mailer: createMailer(),
    appUrl: process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null),
    corsOrigins: corsOrigins(),
    cronSecret: process.env.CRON_SECRET,
    autoSample: process.env.SAMPLE_DATA !== '0',
    digests: true,
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
