// Standard steps for each task type. Everyone reads them; managers change the
// ones for their department's work (see canEditSop), or reset them to the built-in version.
import { Router } from 'express';
import { badRequest, forbidden, oneOf } from '../http.js';
import { ROLES, TASK_TYPES, keys } from '../meta.js';
import { canEditSop, sopSteps } from '../../../client/src/sops.js';
import { nowUtc } from '../time.js';

// Custom SOPs keyed by type: { steps, updated_at, updated_by_name }.
export async function customSops(q) {
  const rows = await q.all('SELECT s.*, u.name AS updated_by_name FROM sops s LEFT JOIN users u ON u.id = s.updated_by');
  return Object.fromEntries(rows.map((r) => [r.type, { steps: JSON.parse(r.steps), updated_at: r.updated_at, updated_by_name: r.updated_by_name }]));
}

// The steps a new task of `type` starts with, in `lang` unless a manager wrote them.
export async function stepsFor(q, type, lang) {
  const row = await q.get('SELECT steps FROM sops WHERE type = ?', [type]);
  return sopSteps(type, lang, row ? { [type]: { steps: JSON.parse(row.steps) } } : null);
}

export default function sopRoutes({ db }) {
  const r = Router();

  r.get('/', async (_req, res) => res.json(await customSops(db)));

  // Empty steps put the built-in version back.
  r.put('/:type', async (req, res) => {
    const type = oneOf(req.params.type, keys(TASK_TYPES), 'type');
    if (!canEditSop(ROLES, req.user.role, TASK_TYPES, type)) throw forbidden('Only the managers responsible for this work can change its SOP');
    if (!Array.isArray(req.body?.steps)) throw badRequest('steps must be a list');
    const steps = req.body.steps.map((s) => String(s).trim().slice(0, 500)).filter(Boolean).slice(0, 50);
    if (!steps.length) await db.run('DELETE FROM sops WHERE type = ?', [type]);
    else {
      await db.run(
        `INSERT INTO sops (type, steps, updated_by, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (type) DO UPDATE SET steps = EXCLUDED.steps, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
        [type, JSON.stringify(steps), req.user.id, nowUtc()],
      );
    }
    res.json(await customSops(db));
  });

  return r;
}
