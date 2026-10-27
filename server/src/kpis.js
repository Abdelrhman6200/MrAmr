// Performance numbers per person over the last `days` days: tasks finished,
// how many by their due date, how long they took, what is late now, calls
// reached, and how fast complaints were closed. Used by Reports and by the
// weekly summary to managers. Times only count tasks finished after they were
// created (imported or sample work can say otherwise).
import { localDate, utcAgo, DAY } from './time.js';

const hours = (from, to) => `EXTRACT(EPOCH FROM (${to}::timestamp - ${from}::timestamp)) / 3600`;

export async function peopleKpis(db, ids, days = 30) {
  if (!ids.length) return [];
  const since = utcAgo(days * DAY);
  const today = localDate();
  const [people, tasks, calls] = await Promise.all([
    db.all('SELECT id, name, role, avatar_color FROM users WHERE id = ANY(?::int[]) AND active = 1 ORDER BY name', [ids]),
    db.all(
      `SELECT t.assignee_id AS id,
         COUNT(*) FILTER (WHERE t.status = 'done' AND t.completed_at >= ?)::int AS done,
         COUNT(*) FILTER (WHERE t.status = 'done' AND t.completed_at >= ? AND t.due_date IS NOT NULL)::int AS done_with_date,
         COUNT(*) FILTER (WHERE t.status = 'done' AND t.completed_at >= ? AND t.due_date IS NOT NULL AND substr(t.completed_at, 1, 10) <= t.due_date)::int AS on_time,
         COUNT(*) FILTER (WHERE t.status <> 'done')::int AS open,
         COUNT(*) FILTER (WHERE t.status <> 'done' AND t.due_date < ?)::int AS overdue,
         ROUND((AVG(${hours('t.created_at', 't.completed_at')}) FILTER (WHERE t.status = 'done' AND t.completed_at >= ? AND t.completed_at >= t.created_at) / 24)::numeric, 1) AS avg_days,
         COUNT(*) FILTER (WHERE t.type = 'complaint' AND t.status = 'done' AND t.completed_at >= ?)::int AS complaints_closed,
         ROUND((AVG(${hours('t.created_at', 't.completed_at')}) FILTER (WHERE t.type = 'complaint' AND t.status = 'done' AND t.completed_at >= ? AND t.completed_at >= t.created_at))::numeric, 1) AS complaint_hours
       FROM tasks t WHERE t.assignee_id = ANY(?::int[]) GROUP BY t.assignee_id`,
      [since, since, since, today, since, since, since, ids],
    ),
    db.all(
      `SELECT user_id AS id, COUNT(*)::int AS calls, COUNT(*) FILTER (WHERE status = 'reached')::int AS reached
       FROM call_logs WHERE user_id = ANY(?::int[]) AND created_at >= ? GROUP BY user_id`,
      [ids, since],
    ),
  ]);
  const t = new Map(tasks.map((x) => [x.id, x]));
  const c = new Map(calls.map((x) => [x.id, x]));
  return people.map((p) => {
    const k = t.get(p.id) || {};
    const call = c.get(p.id) || {};
    return {
      ...p,
      done: k.done || 0,
      open: k.open || 0,
      overdue: k.overdue || 0,
      on_time_pct: k.done_with_date ? Math.round((k.on_time / k.done_with_date) * 100) : null,
      avg_days: k.avg_days != null ? Number(k.avg_days) : null,
      calls: call.calls || 0,
      reach_pct: call.calls ? Math.round((call.reached / call.calls) * 100) : null,
      complaints_closed: k.complaints_closed || 0,
      complaint_hours: k.complaint_hours != null ? Number(k.complaint_hours) : null,
    };
  });
}
