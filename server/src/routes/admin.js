import { Router } from 'express';
import { forbidden } from '../http.js';
import { USER_ADMIN_ROLES } from '../meta.js';

// Everything worth keeping, in an order that respects foreign keys when restoring.
const BACKUP_TABLES = [
  'users',
  'projects',
  'project_members',
  'tasks',
  'checklist_items',
  'comments',
  'activity',
  'notifications',
  'call_lists',
  'calls',
  'call_logs',
  'centers',
  'availability_rounds',
  'availability',
  'center_assignments',
];

export default function adminRoutes({ db }) {
  const r = Router();
  r.use((req, _res, next) => next(USER_ADMIN_ROLES.includes(req.user.role) ? undefined : forbidden()));

  // A consistent JSON snapshot of every table (one read-only transaction).
  r.get('/backup', async (_req, res) => {
    const tables = await db.tx(async (tx) => {
      await tx.run('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const out = {};
      for (const name of BACKUP_TABLES) out[name] = await tx.all(`SELECT * FROM ${name} ORDER BY 1`);
      return out;
    });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    res.setHeader('content-disposition', `attachment; filename="taskflow-backup-${stamp}.json"`);
    res.json({ app: 'taskflow', version: 1, created_at: new Date().toISOString(), tables });
  });

  return r;
}
