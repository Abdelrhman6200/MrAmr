// SOPs: how each type of task is done. Everyone reads them; managers change
// the ones for their department's work (see canEditSop), or reset them to the
// built-in version.
import { Router } from 'express';
import { badRequest, forbidden, oneOf } from '../http.js';
import { ROLES, TASK_TYPES, keys } from '../meta.js';
import { canEditSop, normaliseSop, sopFor } from '../../../client/src/sops.js';
import { localDate, nowUtc } from '../time.js';

const text = (value, max) => String(value || '').trim().slice(0, max);

// Custom SOPs keyed by type: { when, target, steps, done, version, updated_at, updated_by_name }.
export async function customSops(q) {
  const rows = await q.all('SELECT s.*, u.name AS updated_by_name FROM sops s LEFT JOIN users u ON u.id = s.updated_by');
  return Object.fromEntries(
    rows.map((r) => [r.type, { ...normaliseSop(JSON.parse(r.steps)), version: r.version, updated_at: r.updated_at, updated_by_name: r.updated_by_name }]),
  );
}

// The steps ({ text, required }) a new task of `type` starts with, in `lang` unless a manager wrote them.
export async function stepsFor(q, type, lang) {
  const row = await q.get('SELECT steps FROM sops WHERE type = ?', [type]);
  return sopFor(type, lang, row ? { [type]: JSON.parse(row.steps) } : null).steps;
}

export default function sopRoutes({ db, access }) {
  const r = Router();

  r.get('/', async (_req, res) => res.json(await customSops(db)));

  // How each SOP's work went in the last 90 days, over the tasks the user can see:
  // how many, how many are open or late, and how many finished by their due date.
  r.get('/stats', async (req, res) => {
    const scope = await access.taskScope(req.user);
    const rows = await db.all(
      `SELECT t.type,
         COUNT(*)::int AS used,
         COUNT(*) FILTER (WHERE t.status <> 'done')::int AS open,
         COUNT(*) FILTER (WHERE t.status <> 'done' AND t.due_date < ?)::int AS late,
         COUNT(*) FILTER (WHERE t.status = 'done' AND t.due_date IS NOT NULL)::int AS done_with_date,
         COUNT(*) FILTER (WHERE t.status = 'done' AND t.due_date IS NOT NULL AND substr(t.completed_at, 1, 10) <= t.due_date)::int AS on_time
       FROM tasks t WHERE ${scope.sql} AND t.created_at >= ? GROUP BY t.type`,
      [localDate(), ...scope.params, `${localDate(-90)} 00:00:00`],
    );
    res.json(Object.fromEntries(rows.map(({ type, ...stats }) => [type, stats])));
  });

  // Empty steps put the built-in version back.
  r.put('/:type', async (req, res) => {
    const type = oneOf(req.params.type, keys(TASK_TYPES), 'type');
    if (!canEditSop(ROLES, req.user.role, TASK_TYPES, type)) throw forbidden('Only the managers responsible for this work can change its SOP');
    const b = req.body || {};
    if (!Array.isArray(b.steps)) throw badRequest('steps must be a list');
    const sop = normaliseSop({
      when: text(b.when, 500),
      target: text(b.target, 300),
      done: text(b.done, 500),
      steps: b.steps.slice(0, 50).map((s) => (typeof s === 'string' ? text(s, 500) : { text: text(s?.text, 500), required: !!s?.required })),
    });
    if (!sop.steps.length) await db.run('DELETE FROM sops WHERE type = ?', [type]);
    else {
      await db.run(
        `INSERT INTO sops (type, steps, updated_by, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (type) DO UPDATE SET steps = EXCLUDED.steps, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at, version = sops.version + 1`,
        [type, JSON.stringify(sop), req.user.id, nowUtc()],
      );
    }
    res.json(await customSops(db));
  });

  return r;
}
