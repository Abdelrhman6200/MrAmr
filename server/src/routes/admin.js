import { Router } from 'express';
import { HttpError, forbidden } from '../http.js';
import { USER_ADMIN_ROLES } from '../meta.js';
import { hasSampleData, noteStatus, removeSampleData, seed } from '../seed.js';

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
  'sops',
  'delegations',
  'recurring_tasks',
  'students',
  'assessments',
  'marks',
  'mistakes',
  'leave_requests',
  'shifts',
  'audit_log',
  'platform_stats',
  'platform_progress',
];
// Not in the backup: attachments (files can be large; download them from their tasks).

const safeJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

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

  // Who changed what, newest first.
  r.get('/audit', async (req, res) => {
    const before = Number(req.query.before) || null;
    const rows = await db.all(
      `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE (?::int IS NULL OR a.id < ?) ORDER BY a.id DESC LIMIT 100`,
      [before, before],
    );
    res.json(rows.map((r) => ({ ...r, detail: safeJson(r.detail) })));
  });

  // Sample team, projects, tasks, calls and centers for trying the app out.
  r.post('/sample', async (req, res) => {
    if (req.user.role !== 'ceo') throw forbidden('Only the Head of Company can load sample data');
    if (await hasSampleData(db)) throw new HttpError(409, 'Sample data is already loaded', 'sample_loaded');
    const clash = await db.get("SELECT 1 FROM users WHERE email LIKE '%@taskflow.local' LIMIT 1");
    if (clash) throw new HttpError(409, 'Sample data is already loaded', 'sample_loaded');
    await seed(db, { ceo: req.user });
    await noteStatus(db, 'sample', `loaded under ${req.user.email}`);
    res.status(201).json({ ok: true });
  });

  r.delete('/sample', async (req, res) => {
    if (req.user.role !== 'ceo') throw forbidden('Only the Head of Company can remove sample data');
    res.json({ removed: await removeSampleData(db, req.user) });
  });

  return r;
}
