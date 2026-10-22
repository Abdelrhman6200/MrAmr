import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { requireAuth } from './auth.js';
import { makeAccess } from './access.js';
import { HttpError } from './http.js';
import { DEPARTMENTS, ROLES, STATUSES, PRIORITIES, TASK_TYPES, PROJECT_STATUSES, USER_ADMIN_ROLES, CALL_STATUSES, CENTER_ADMIN_ROLES, WEEKDAYS } from './meta.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import projectRoutes from './routes/projects.js';
import taskRoutes from './routes/tasks.js';
import dashboardRoutes from './routes/dashboard.js';
import notificationRoutes from './routes/notifications.js';
import callRoutes from './routes/calls.js';
import centerRoutes from './routes/centers.js';
import adminRoutes from './routes/admin.js';
import { cors, securityHeaders } from './security.js';
import { createMailer, emailDispatcher } from './mail.js';
import { background } from './background.js';

export function createApp({ db, secret, staticDir, mailer = createMailer({}), appUrl = null, corsOrigins = [], cronSecret = null, autoSample = false }) {
  const app = express();
  const access = makeAccess(db);
  // appUrl (APP_URL) is the public address used in emailed links; never derived from request headers.
  const ctx = { db, secret, access, mailer, autoSample, appUrl: appUrl ? appUrl.replace(/\/+$/, '') : null };
  const dispatchEmails = emailDispatcher(db, mailer, ctx.appUrl);
  app.locals.dispatchEmails = dispatchEmails;

  // Behind a reverse proxy (nginx, a load balancer) set TRUST_PROXY=1 so login throttling sees real client IPs.
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  if (corsOrigins.length) app.use('/api', cors(corsOrigins));

  // Hosting platforms cap request bodies (Vercel: 4.5 MB); big call sheets are sent in parts.
  app.use(express.json({ limit: '4mb' }));

  // Changes can create notifications; email them once the response is on its way.
  if (mailer.enabled) {
    app.use('/api', (req, res, next) => {
      if (req.method !== 'GET') res.on('finish', () => res.statusCode < 400 && background('Notification emails', dispatchEmails));
      next();
    });
  }

  // The login page only offers demo accounts while the demo company is loaded.
  // demo: the login page offers demo accounts. needsSetup: until the first account
  // exists, the web app shows a set-up form instead of sign-in. One round trip.
  const appState = () =>
    db.get(`SELECT
      EXISTS (SELECT 1 FROM users WHERE email = 'ceo@taskflow.local' AND active = 1) AS demo,
      NOT EXISTS (SELECT 1 FROM users) AS needs_setup,
      EXISTS (SELECT 1 FROM sample_rows) AS sample_data`);

  const api = express.Router();
  // Also says where the server and the database run: if they're far apart, every
  // page waits on long round trips (fix: Vercel → Settings → Functions → region).
  api.get('/health', async (_req, res) => {
    const start = Date.now();
    await db.get('SELECT 1');
    const where = {};
    if (process.env.VERCEL_REGION) where.server_region = process.env.VERCEL_REGION;
    if (db.region) where.database_region = db.region;
    res.json({ ok: true, ...where, ...(where.server_region ? { database_ms: Date.now() - start } : {}) });
  });
  api.get('/meta', async (_req, res) => {
    const state = await appState();
    res.json({ departments: DEPARTMENTS, roles: ROLES, statuses: STATUSES, priorities: PRIORITIES, taskTypes: TASK_TYPES, projectStatuses: PROJECT_STATUSES, userAdminRoles: USER_ADMIN_ROLES, callStatuses: CALL_STATUSES, centerAdminRoles: CENTER_ADMIN_ROLES, weekdays: WEEKDAYS, emailEnabled: mailer.enabled, resetByEmail: mailer.enabled && !!ctx.appUrl, demo: state.demo, needsSetup: state.needs_setup, sampleData: state.sample_data });
  });
  // Scheduled sweep (Vercel Cron) that retries any notification emails left behind.
  api.get('/cron/emails', async (req, res) => {
    if (!cronSecret || req.get('authorization') !== `Bearer ${cronSecret}`) throw new HttpError(401, 'Not authenticated');
    await dispatchEmails();
    res.json({ ok: true });
  });
  api.use('/auth', authRoutes(ctx));
  api.use(requireAuth(db, secret));
  // Refresh the cached org chart if another instance changed it.
  api.use(async (req, _res, next) => {
    try {
      await access.sync(req.orgVersion);
      next();
    } catch (err) {
      next(err);
    }
  });
  api.use('/users', userRoutes(ctx));
  api.use('/projects', projectRoutes(ctx));
  api.use('/tasks', taskRoutes(ctx));
  api.use('/dashboard', dashboardRoutes(ctx));
  api.use('/notifications', notificationRoutes(ctx));
  api.use('/calls', callRoutes(ctx));
  api.use('/centers', centerRoutes(ctx));
  api.use('/admin', adminRoutes(ctx));
  api.use((_req, _res, next) => next(new HttpError(404, 'Unknown API route')));
  app.use('/api', api);

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  app.use((err, req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    if (status >= 500) {
      // An error code (database or network) helps diagnose without revealing anything;
      // the Head of Company also sees the underlying message.
      const ref = typeof err.code === 'string' && /^([0-9A-Z]{5}|E[A-Z_]+)$/.test(err.code) ? err.code : undefined;
      const message = req.user?.role === 'ceo' ? String(err.message || '').slice(0, 200) : undefined;
      return res.status(status).json({ error: 'Internal server error', code: 'internal', details: { ref, message } });
    }
    res.status(status).json({ error: err.message, code: err.code, details: err.details });
  });

  return app;
}
