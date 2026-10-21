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
import { securityHeaders } from './security.js';

export function createApp({ db, secret, staticDir }) {
  const app = express();
  const access = makeAccess(db);
  const ctx = { db, secret, access };

  // Behind a reverse proxy (nginx, a load balancer) set TRUST_PROXY=1 so login throttling sees real client IPs.
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(securityHeaders);

  // Large enough for a few thousand uploaded call-sheet rows.
  app.use(express.json({ limit: '10mb' }));

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.get('/meta', (_req, res) =>
    res.json({ departments: DEPARTMENTS, roles: ROLES, statuses: STATUSES, priorities: PRIORITIES, taskTypes: TASK_TYPES, projectStatuses: PROJECT_STATUSES, userAdminRoles: USER_ADMIN_ROLES, callStatuses: CALL_STATUSES, centerAdminRoles: CENTER_ADMIN_ROLES, weekdays: WEEKDAYS }),
  );
  api.use('/auth', authRoutes(ctx));
  api.use(requireAuth(db, secret));
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

  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message, code: err.code, details: err.details });
  });

  return app;
}
