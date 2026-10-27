// Recurring tasks: work that repeats daily, weekly or monthly. Each period gets
// its own task (with the type's SOP as its checklist), created by weekly.js.
import { Router } from 'express';
import { badRequest, forbidden, idParam, notFound, oneOf, optionalId, requiredString } from '../http.js';
import { PRIORITIES, TASK_TYPES, TRACKS, keys } from '../meta.js';
import { ensureRecurring, periodOf } from '../weekly.js';
import { audit } from '../audit.js';

const FREQUENCIES = ['daily', 'weekly', 'monthly'];

export default function recurringRoutes({ db, access }) {
  const r = Router();

  const SELECT = `
    SELECT r.*, a.name AS assignee_name, a.avatar_color AS assignee_color, rv.name AS reviewer_name, p.name AS project_name,
      (SELECT MAX(t.due_date) FROM tasks t WHERE t.recurring_id = r.id) AS last_due
    FROM recurring_tasks r JOIN users a ON a.id = r.assignee_id
    LEFT JOIN users rv ON rv.id = r.reviewer_id LEFT JOIN projects p ON p.id = r.project_id`;

  // Who may change one: whoever set it up, whoever manages the assignee, the Head of Company.
  const canManage = (user, row) => user.role === 'ceo' || row.created_by === user.id || access.managesUser(user, row.assignee_id);

  async function fields(user, b, current = {}) {
    const f = {
      title: b.title !== undefined ? requiredString(b.title, 'title', 300) : current.title,
      description: b.description !== undefined ? String(b.description || '').slice(0, 5000) : current.description ?? '',
      type: b.type !== undefined ? oneOf(b.type, keys(TASK_TYPES), 'type') : current.type ?? 'general',
      priority: b.priority !== undefined ? oneOf(b.priority, keys(PRIORITIES), 'priority') : current.priority ?? 'medium',
      project_id: b.project_id !== undefined ? optionalId(b.project_id, 'project_id') ?? null : current.project_id ?? null,
      assignee_id: b.assignee_id !== undefined ? optionalId(b.assignee_id, 'assignee_id') : current.assignee_id ?? user.id,
      reviewer_id: b.reviewer_id !== undefined ? optionalId(b.reviewer_id, 'reviewer_id') ?? null : current.reviewer_id ?? null,
      track: b.track !== undefined ? keys(TRACKS).filter((k) => String(b.track || '').split(',').includes(k)).join(',') : current.track ?? '',
      frequency: b.frequency !== undefined ? oneOf(b.frequency, FREQUENCIES, 'frequency') : current.frequency,
      weekday: b.weekday !== undefined ? Number(b.weekday) : current.weekday ?? 0,
      month_day: b.month_day !== undefined ? Number(b.month_day) : current.month_day ?? 1,
      active: b.active !== undefined ? (b.active ? 1 : 0) : current.active ?? 1,
    };
    if (!f.frequency) throw badRequest('Choose how often it repeats');
    if (!Number.isInteger(f.weekday) || f.weekday < 0 || f.weekday > 6) throw badRequest('Choose the day of the week');
    if (!Number.isInteger(f.month_day) || f.month_day < 1 || f.month_day > 31) throw badRequest('Choose a day of the month from 1 to 31');
    if (!f.assignee_id) throw badRequest('Choose who does it');
    if (f.assignee_id !== current.assignee_id && !(await access.assignableIds(user, f.project_id)).has(f.assignee_id)) {
      throw forbidden('You can set recurring work for yourself, your team, project members or a manager');
    }
    return f;
  }

  // The recurring work the user set up, does, or manages.
  r.get('/', async (req, res) => {
    const me = req.user;
    const rows =
      me.role === 'ceo'
        ? await db.all(`${SELECT} ORDER BY r.active DESC, r.title`)
        : await db.all(`${SELECT} WHERE r.created_by = ? OR r.assignee_id = ANY(?::int[]) ORDER BY r.active DESC, r.title`, [me.id, [...access.teamIds(me)]]);
    res.json(rows.map((row) => ({ ...row, next_due: row.active ? periodOf(row)?.due ?? null : null, can_manage: canManage(me, row) })));
  });

  r.post('/', async (req, res) => {
    const f = await fields(req.user, req.body || {});
    const row = await db.tx(async (tx) => {
      const created = await tx.get(
        `INSERT INTO recurring_tasks (title, description, type, priority, project_id, assignee_id, reviewer_id, track, frequency, weekday, month_day, active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [f.title, f.description, f.type, f.priority, f.project_id, f.assignee_id, f.reviewer_id, f.track, f.frequency, f.weekday, f.month_day, f.active, req.user.id],
      );
      await audit(tx, req.user, 'created', 'recurring', created.id, { title: f.title, frequency: f.frequency });
      return created;
    });
    await ensureRecurring(db); // this period's task straight away
    res.status(201).json(await db.get(`${SELECT} WHERE r.id = ?`, [row.id]));
  });

  r.patch('/:id', async (req, res) => {
    const current = await db.get('SELECT * FROM recurring_tasks WHERE id = ?', [idParam(req.params.id)]);
    if (!current) throw notFound('Not found');
    if (!canManage(req.user, current)) throw forbidden();
    const f = await fields(req.user, req.body || {}, current);
    await db.tx(async (tx) => {
      await tx.run(
        `UPDATE recurring_tasks SET title = ?, description = ?, type = ?, priority = ?, project_id = ?, assignee_id = ?, reviewer_id = ?, track = ?,
           frequency = ?, weekday = ?, month_day = ?, active = ? WHERE id = ?`,
        [f.title, f.description, f.type, f.priority, f.project_id, f.assignee_id, f.reviewer_id, f.track, f.frequency, f.weekday, f.month_day, f.active, current.id],
      );
      await audit(tx, req.user, f.active ? 'updated' : 'paused', 'recurring', current.id, { title: f.title });
    });
    if (f.active) await ensureRecurring(db);
    res.json(await db.get(`${SELECT} WHERE r.id = ?`, [current.id]));
  });

  // Stops it; the tasks already created stay.
  r.delete('/:id', async (req, res) => {
    const current = await db.get('SELECT * FROM recurring_tasks WHERE id = ?', [idParam(req.params.id)]);
    if (!current) throw notFound('Not found');
    if (!canManage(req.user, current)) throw forbidden();
    await db.tx(async (tx) => {
      await tx.run('DELETE FROM recurring_tasks WHERE id = ?', [current.id]);
      await audit(tx, req.user, 'deleted', 'recurring', current.id, { title: current.title });
    });
    res.status(204).end();
  });

  return r;
}
