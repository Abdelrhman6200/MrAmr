// Deputies (ينوب عنه): while a manager is away, someone acts for them between
// two dates, with their team, reviews and calls (see access.js). Also handing an
// absent person's open work over to someone else.
import { Router } from 'express';
import { badRequest, forbidden, idParam, notFound, optionalId } from '../http.js';
import { CALL_STATUSES, isManagerRole } from '../meta.js';
import { localDate, nowUtc } from '../time.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 120;
const OPEN_CALLS = CALL_STATUSES.filter((s) => s.open).map((s) => s.key);

function dates(b) {
  const starts = String(b.starts_on || '');
  const ends = String(b.ends_on || '');
  if (!DATE_RE.test(starts) || !DATE_RE.test(ends)) throw badRequest('Pick the first and last day');
  if (ends < starts) throw badRequest('The last day is before the first day');
  if (ends < localDate()) throw badRequest('That period is already over');
  if ((Date.parse(ends) - Date.parse(starts)) / 864e5 > MAX_DAYS) throw badRequest(`A deputy can cover at most ${MAX_DAYS} days at a time`);
  return [starts, ends];
}

export default function delegationRoutes({ db, access }) {
  const r = Router();

  // Who may set or cancel a deputy for `userId`: themselves, whoever manages them, user admins.
  const canArrange = (user, userId) => user.id === userId || access.managesUser(user, userId) || access.canAdminUsers(user);

  const SELECT = `
    SELECT d.*, u.name AS user_name, u.role AS user_role, dp.name AS deputy_name, dp.role AS deputy_role, c.name AS created_by_name
    FROM delegations d JOIN users u ON u.id = d.user_id JOIN users dp ON dp.id = d.deputy_id LEFT JOIN users c ON c.id = d.created_by`;

  // Current and upcoming deputies that involve the user: theirs, the ones they
  // act as, and their team's (everything for user admins).
  r.get('/', async (req, res) => {
    const me = req.user;
    const team = [...access.teamIds(me)];
    const rows = await db.all(
      `${SELECT} WHERE d.ends_on >= ? AND (? OR d.user_id = ANY(?::int[]) OR d.deputy_id = ?) ORDER BY d.starts_on, d.id`,
      [localDate(), access.canAdminUsers(me) || me.role === 'ceo', team, me.id],
    );
    const today = localDate();
    res.json(rows.map((d) => ({ ...d, active: d.starts_on <= today, can_cancel: canArrange(me, d.user_id) || d.created_by === me.id })));
  });

  r.post('/', async (req, res) => {
    const b = req.body || {};
    const userId = optionalId(b.user_id, 'user_id') ?? req.user.id;
    const deputyId = optionalId(b.deputy_id, 'deputy_id');
    if (!canArrange(req.user, userId)) throw forbidden('You can only set a deputy for yourself or the people you manage');
    const [person, deputy] = await Promise.all([
      db.get('SELECT id, name, role, active FROM users WHERE id = ?', [userId]),
      deputyId ? db.get('SELECT id, name, active FROM users WHERE id = ?', [deputyId]) : null,
    ]);
    if (!person?.active) throw badRequest('Person not found');
    if (!isManagerRole(person.role) && !access.ownReports(userId).size) throw badRequest('Only managers and team leaders have a deputy; hand over the work instead');
    if (!deputy?.active) throw badRequest('Pick who will act for them');
    if (deputy.id === person.id) throw badRequest('Pick someone else as the deputy');
    const [starts, ends] = dates(b);
    const overlap = await db.get('SELECT 1 FROM delegations WHERE user_id = ? AND starts_on <= ? AND ends_on >= ?', [userId, ends, starts]);
    if (overlap) throw badRequest('They already have a deputy for some of those days');

    const row = await db.tx(async (tx) => {
      const d = await tx.get(
        'INSERT INTO delegations (user_id, deputy_id, starts_on, ends_on, note, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
        [userId, deputyId, starts, ends, String(b.note || '').trim().slice(0, 300), req.user.id],
      );
      await tx.run("INSERT INTO notifications (user_id, type, message, link, params) VALUES (?, 'deputy_assigned', ?, '/team?tab=cover', ?)", [
        deputyId,
        `You will act for ${person.name} from ${starts} to ${ends}`,
        JSON.stringify({ name: person.name, from: starts, to: ends }),
      ]);
      await access.invalidate(tx);
      return d;
    });
    res.status(201).json(await db.get(`${SELECT} WHERE d.id = ?`, [row.id]));
  });

  r.delete('/:id', async (req, res) => {
    const d = await db.get('SELECT * FROM delegations WHERE id = ?', [idParam(req.params.id)]);
    if (!d) throw notFound('Not found');
    if (!canArrange(req.user, d.user_id) && d.created_by !== req.user.id) throw forbidden();
    await db.tx(async (tx) => {
      await tx.run('DELETE FROM delegations WHERE id = ?', [d.id]);
      await access.invalidate(tx);
    });
    res.status(204).end();
  });

  // Moves someone's open tasks and calls to a colleague (an agent off sick, someone leaving).
  r.post('/handover', async (req, res) => {
    const b = req.body || {};
    const fromId = optionalId(b.from_id, 'from_id');
    const toId = optionalId(b.to_id, 'to_id');
    if (!fromId || !toId || fromId === toId) throw badRequest('Pick who the work moves from and to');
    if (!access.managesUser(req.user, fromId)) throw forbidden('You can only hand over the work of people you manage');
    if (!access.teamIds(req.user).has(toId) && !access.managesUser(req.user, toId)) throw forbidden('Hand the work to someone on your team');
    const [from, to] = await Promise.all([
      db.get('SELECT id, name FROM users WHERE id = ?', [fromId]),
      db.get('SELECT id, name, active FROM users WHERE id = ?', [toId]),
    ]);
    if (!from || !to?.active) throw badRequest('Person not found');
    const withTasks = b.tasks !== false;
    const withCalls = b.calls !== false;

    const moved = await db.tx(async (tx) => {
      const now = nowUtc();
      const tasks = withTasks
        ? await tx.all("UPDATE tasks SET assignee_id = ?, updated_at = ? WHERE assignee_id = ? AND status <> 'done' RETURNING id, project_id, title", [toId, now, fromId])
        : [];
      if (tasks.length) {
        await tx.run(
          "INSERT INTO activity (task_id, project_id, user_id, action, detail) SELECT t.id, t.project_id, ?, 'assigned', ? FROM unnest(?::int[], ?::int[]) AS t(id, project_id)",
          [req.user.id, `${to.name} (from ${from.name})`, tasks.map((t) => t.id), tasks.map((t) => t.project_id)],
        );
      }
      const calls = withCalls ? (await tx.run('UPDATE calls SET assignee_id = ? WHERE assignee_id = ? AND status = ANY(?::text[])', [toId, fromId, OPEN_CALLS])).rowCount : 0;
      if ((tasks.length || calls) && toId !== req.user.id) {
        await tx.run("INSERT INTO notifications (user_id, type, message, link, params) VALUES (?, 'handover', ?, '/tasks?scope=mine', ?)", [
          toId,
          `${req.user.name} handed you ${from.name}'s open work: ${tasks.length} task(s), ${calls} call(s)`,
          JSON.stringify({ actor: req.user.name, from: from.name, tasks: tasks.length, calls }),
        ]);
      }
      return { tasks: tasks.length, calls };
    });
    res.json(moved);
  });

  // How much open work someone has, before handing it over.
  r.get('/open-work/:userId', async (req, res) => {
    const id = idParam(req.params.userId);
    if (!access.managesUser(req.user, id)) throw forbidden();
    const row = await db.get(
      `SELECT (SELECT COUNT(*) FROM tasks WHERE assignee_id = ? AND status <> 'done')::int AS tasks,
              (SELECT COUNT(*) FROM calls WHERE assignee_id = ? AND status = ANY(?::text[]))::int AS calls`,
      [id, id, OPEN_CALLS],
    );
    res.json(row);
  });

  return r;
}
