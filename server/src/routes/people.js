// Leave and shifts.
// - Leave: someone asks for days off (with an optional deputy); their manager
//   approves or turns it down. An approved leave with a deputy also makes the
//   delegation, so the deputy acts for them on those days.
// - Shifts: each person's weekly working hours (e.g. Customer Service), set by
//   their manager; everyone sees who is on today.
import { Router } from 'express';
import { badRequest, forbidden, idParam, notFound, oneOf, optionalId } from '../http.js';
import { WEEKDAYS, isManagerRole } from '../meta.js';
import { localDate, nowUtc } from '../time.js';
import { audit } from '../audit.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const KINDS = ['annual', 'sick', 'other'];

const weekdayOf = (date) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 1) % 7; // 0 = Saturday

export function leaveRoutes({ db, access }) {
  const r = Router();
  const SELECT = `
    SELECT l.*, u.name AS user_name, u.role AS user_role, u.avatar_color, d.name AS deputy_name, x.name AS decided_by_name
    FROM leave_requests l JOIN users u ON u.id = l.user_id LEFT JOIN users d ON d.id = l.deputy_id LEFT JOIN users x ON x.id = l.decided_by`;
  const canDecide = (user, l) => access.managesUser(user, l.user_id) || (access.canAdminUsers(user) && l.user_id !== user.id);
  const notify = (q, userId, type, message, params) =>
    q.run("INSERT INTO notifications (user_id, type, message, link, params) VALUES (?, ?, ?, '/team?tab=leave', ?)", [userId, type, message, JSON.stringify(params)]);

  // Mine, the ones waiting on me, and who is off today.
  r.get('/', async (req, res) => {
    const me = req.user;
    const today = localDate();
    const team = [...access.reportsOf(me.id)];
    const everyone = me.role === 'ceo' || access.canAdminUsers(me);
    const [mine, team_requests, off] = await Promise.all([
      db.all(`${SELECT} WHERE l.user_id = ? ORDER BY l.starts_on DESC LIMIT 50`, [me.id]),
      db.all(`${SELECT} WHERE l.user_id = ANY(?::int[]) AND (l.status = 'pending' OR l.ends_on >= ?) ORDER BY l.status = 'pending' DESC, l.starts_on`, [team, today]),
      db.all(
        `${SELECT} WHERE l.status = 'approved' AND l.starts_on <= ? AND l.ends_on >= ? AND (? OR l.user_id = ANY(?::int[])) ORDER BY u.name`,
        [today, today, everyone, [me.id, ...team]],
      ),
    ]);
    res.json({ mine, team: team_requests.map((l) => ({ ...l, can_decide: canDecide(me, l) })), off_today: off });
  });

  r.post('/', async (req, res) => {
    const b = req.body || {};
    const starts = String(b.starts_on || '');
    const ends = String(b.ends_on || '');
    if (!DATE_RE.test(starts) || !DATE_RE.test(ends)) throw badRequest('Pick the first and last day');
    if (ends < starts) throw badRequest('The last day is before the first day');
    if (ends < localDate()) throw badRequest('That period is already over');
    const deputyId = optionalId(b.deputy_id, 'deputy_id') ?? null;
    if (deputyId === req.user.id) throw badRequest('Pick someone else as the deputy');
    const me = await db.get('SELECT id, name, manager_id FROM users WHERE id = ?', [req.user.id]);
    const row = await db.tx(async (tx) => {
      const l = await tx.get(
        'INSERT INTO leave_requests (user_id, kind, starts_on, ends_on, note, deputy_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
        [me.id, oneOf(b.kind || 'annual', KINDS, 'kind'), starts, ends, String(b.note || '').trim().slice(0, 300), deputyId],
      );
      // The manager decides; whoever acts for them today gets it too.
      const deciders = me.manager_id ? [me.manager_id, ...access.deputiesOf(me.manager_id)] : [];
      for (const id of deciders) await notify(tx, id, 'leave_requested', `${me.name} asked for leave from ${starts} to ${ends}`, { name: me.name, from: starts, to: ends });
      return l;
    });
    res.status(201).json(await db.get(`${SELECT} WHERE l.id = ?`, [row.id]));
  });

  r.post('/:id/decide', async (req, res) => {
    const l = await db.get('SELECT * FROM leave_requests WHERE id = ?', [idParam(req.params.id)]);
    if (!l) throw notFound('Not found');
    if (!canDecide(req.user, l)) throw forbidden('Only their manager decides on this leave');
    if (l.status !== 'pending') throw badRequest('This request was already decided');
    const decision = oneOf(req.body?.decision, ['approve', 'reject'], 'decision');
    const note = String(req.body?.note || '').trim().slice(0, 300);
    await db.tx(async (tx) => {
      let delegationId = null;
      const person = await tx.get('SELECT id, name, role FROM users WHERE id = ?', [l.user_id]);
      // A manager's (or team leader's) deputy acts for them while they are away.
      if (decision === 'approve' && l.deputy_id && (isManagerRole(person.role) || access.ownReports(person.id).size)) {
        const overlap = await tx.get('SELECT 1 FROM delegations WHERE user_id = ? AND starts_on <= ? AND ends_on >= ?', [l.user_id, l.ends_on, l.starts_on]);
        if (!overlap) {
          const d = await tx.get(
            "INSERT INTO delegations (user_id, deputy_id, starts_on, ends_on, note, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
            [l.user_id, l.deputy_id, l.starts_on, l.ends_on, `Leave (${l.kind})`, req.user.id],
          );
          delegationId = d.id;
          await tx.run("INSERT INTO notifications (user_id, type, message, link, params) VALUES (?, 'deputy_assigned', ?, '/team?tab=cover', ?)", [
            l.deputy_id,
            `You will act for ${person.name} from ${l.starts_on} to ${l.ends_on}`,
            JSON.stringify({ name: person.name, from: l.starts_on, to: l.ends_on }),
          ]);
          await access.invalidate(tx);
        }
      }
      await tx.run('UPDATE leave_requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, delegation_id = ? WHERE id = ?', [
        decision === 'approve' ? 'approved' : 'rejected',
        req.user.id,
        nowUtc(),
        note,
        delegationId,
        l.id,
      ]);
      await notify(tx, l.user_id, decision === 'approve' ? 'leave_approved' : 'leave_rejected', `Your leave from ${l.starts_on} to ${l.ends_on} was ${decision === 'approve' ? 'approved' : 'turned down'}`, {
        actor: req.user.name,
        from: l.starts_on,
        to: l.ends_on,
      });
      await audit(tx, req.user, decision === 'approve' ? 'approved' : 'rejected', 'leave', l.id, { name: person.name, from: l.starts_on, to: l.ends_on });
    });
    res.json(await db.get(`${SELECT} WHERE l.id = ?`, [l.id]));
  });

  // The person cancels a request that hasn't started (its deputy goes with it).
  r.delete('/:id', async (req, res) => {
    const l = await db.get('SELECT * FROM leave_requests WHERE id = ?', [idParam(req.params.id)]);
    if (!l) throw notFound('Not found');
    if (l.user_id !== req.user.id && !canDecide(req.user, l)) throw forbidden();
    if (l.status === 'approved' && l.starts_on <= localDate()) throw badRequest('This leave has already started');
    await db.tx(async (tx) => {
      if (l.delegation_id) {
        await tx.run('DELETE FROM delegations WHERE id = ?', [l.delegation_id]);
        await access.invalidate(tx);
      }
      await tx.run('DELETE FROM leave_requests WHERE id = ?', [l.id]);
    });
    res.status(204).end();
  });

  return r;
}

export function shiftRoutes({ db, access }) {
  const r = Router();

  // The shifts of the user's team (everyone's for leadership), and who is on today.
  r.get('/', async (req, res) => {
    const me = req.user;
    const everyone = me.role === 'ceo' || access.canAdminUsers(me);
    const rows = await db.all(
      `SELECT s.*, u.name AS user_name, u.avatar_color, u.role FROM shifts s JOIN users u ON u.id = s.user_id AND u.active = 1
       WHERE ? OR s.user_id = ANY(?::int[]) ORDER BY u.name, s.weekday, s.start_time`,
      [everyone, [...access.teamIds(me)]],
    );
    const today = localDate();
    const off = new Set(
      (await db.all("SELECT user_id FROM leave_requests WHERE status = 'approved' AND starts_on <= ? AND ends_on >= ?", [today, today])).map((x) => x.user_id),
    );
    const day = weekdayOf(today);
    res.json({ shifts: rows, today: day, on_today: rows.filter((s) => s.weekday === day && !off.has(s.user_id)) });
  });

  // Replaces one person's weekly shifts.
  r.put('/:userId', async (req, res) => {
    const userId = idParam(req.params.userId);
    if (!access.managesUser(req.user, userId) && !access.canAdminUsers(req.user)) throw forbidden('Only their manager sets their shifts');
    const list = Array.isArray(req.body?.shifts) ? req.body.shifts.slice(0, 21) : null;
    if (!list) throw badRequest('shifts must be a list');
    const clean = list.map((s) => {
      const weekday = Number(s?.weekday);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday >= WEEKDAYS.length) throw badRequest('Choose the day');
      if (!TIME_RE.test(s?.start_time || '') || !TIME_RE.test(s?.end_time || '') || s.end_time <= s.start_time) throw badRequest('Each shift needs a start before its end');
      return { weekday, start_time: s.start_time, end_time: s.end_time };
    });
    const person = await db.get('SELECT id, name FROM users WHERE id = ?', [userId]);
    if (!person) throw notFound('User not found');
    await db.tx(async (tx) => {
      await tx.run('DELETE FROM shifts WHERE user_id = ?', [userId]);
      for (const s of clean) {
        await tx.run('INSERT INTO shifts (user_id, weekday, start_time, end_time, created_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', [userId, s.weekday, s.start_time, s.end_time, req.user.id]);
      }
      await audit(tx, req.user, 'updated', 'shifts', userId, { name: person.name, shifts: clean.length });
    });
    res.json(await db.all('SELECT * FROM shifts WHERE user_id = ? ORDER BY weekday, start_time', [userId]));
  });

  return r;
}
