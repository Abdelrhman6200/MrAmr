import { Router } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { forbidden } from '../http.js';
import { USER_ADMIN_ROLES } from '../meta.js';

export default function adminRoutes({ db }) {
  const r = Router();
  r.use((req, _res, next) => next(USER_ADMIN_ROLES.includes(req.user.role) ? undefined : forbidden()));

  // A consistent copy of the whole database, safe to take while the app runs.
  r.get('/backup', (_req, res, next) => {
    const file = path.join(os.tmpdir(), `taskflow-backup-${process.pid}-${Date.now()}.db`);
    try {
      db.prepare('VACUUM INTO ?').run(file);
    } catch (err) {
      return next(err);
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    res.download(file, `taskflow-backup-${stamp}.db`, () => fs.rm(file, { force: true }, () => {}));
  });

  return r;
}
