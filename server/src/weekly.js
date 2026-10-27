// Recurring weekly duties (meta WEEKLY_DUTIES): each week, everyone in those roles
// gets one task with the week's checklist, due on Friday and reviewed by their
// manager. Safe to call often and from several instances: a unique index on
// (assignee_id, weekly_key) keeps it to one task per person per week.
import { WEEKLY_DUTIES } from './meta.js';
import { localDate } from './time.js';
import { translate } from '../../client/src/i18n.js';

const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

// The Saturday that starts the current week, in the app's time zone.
export function weekStart(today = localDate()) {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // Saturday = 6
  return shift(today, -((weekday + 1) % 7));
}

export async function ensureWeeklyDuties(db, week = weekStart()) {
  const roles = Object.keys(WEEKLY_DUTIES);
  const people = await db.all(
    `SELECT u.id, u.name, u.role, u.language, u.manager_id FROM users u
     WHERE u.active = 1 AND u.role = ANY(?::text[])
       AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.assignee_id = u.id AND t.weekly_key = ?)`,
    [roles, week],
  );
  if (!people.length) return 0;
  let created = 0;
  await db.tx(async (tx) => {
    for (const u of people) {
      const lang = u.language === 'ar' ? 'ar' : 'en';
      const title = translate(lang, 'weekly.title', { date: week });
      const task = await tx.get(
        `INSERT INTO tasks (title, description, type, priority, assignee_id, reporter_id, reviewer_id, start_date, due_date, weekly_key)
         VALUES (?, ?, 'weekly_duties', 'high', ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id`,
        [title, translate(lang, 'weekly.description'), u.id, u.manager_id ?? u.id, u.manager_id, week, shift(week, 6), week],
      );
      if (!task) continue; // another instance got there first
      created++;
      const items = WEEKLY_DUTIES[u.role].map((key) => translate(lang, key));
      // Every weekly duty is required before the task can go to review.
      await tx.run(
        'INSERT INTO checklist_items (task_id, text, required, position) SELECT ?, text, 1, pos - 1 FROM unnest(?::text[]) WITH ORDINALITY AS i(text, pos)',
        [task.id, items],
      );
      await tx.run("INSERT INTO activity (task_id, user_id, action, detail) VALUES (?, NULL, 'created', ?)", [task.id, title]);
      await tx.run("INSERT INTO notifications (user_id, type, message, task_id, params) VALUES (?, 'weekly_duties', ?, ?, ?)", [
        u.id,
        `Your duties for the week of ${week} are ready`,
        task.id,
        JSON.stringify({ title, date: week }),
      ]);
    }
  });
  return created;
}

// ---- recurring tasks --------------------------------------------------------
// Each active recurring task gets one task per period: daily (not on Fridays),
// weekly (due on its weekday, 0 = Saturday) or monthly (due on its day).

const lastDay = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

// The period key and due date of `r` for `today`, or null if nothing is due (a daily one on Friday).
export function periodOf(r, today = localDate()) {
  if (r.frequency === 'daily') return new Date(`${today}T00:00:00Z`).getUTCDay() === 5 ? null : { key: today, due: today };
  if (r.frequency === 'weekly') {
    const week = weekStart(today);
    return { key: week, due: shift(week, Number(r.weekday) || 0) };
  }
  const ym = today.slice(0, 7);
  const day = Math.min(Math.max(Number(r.month_day) || 1, 1), lastDay(ym));
  return { key: ym, due: `${ym}-${String(day).padStart(2, '0')}` };
}

export async function ensureRecurring(db, today = localDate()) {
  const rows = await db.all(
    `SELECT r.*, u.language, u.name AS assignee_name FROM recurring_tasks r JOIN users u ON u.id = r.assignee_id AND u.active = 1
     WHERE r.active = 1`,
  );
  const due = rows.map((r) => ({ r, period: periodOf(r, today) })).filter((x) => x.period);
  if (!due.length) return 0;
  const have = new Set(
    (await db.all('SELECT recurring_id, recur_key FROM tasks WHERE recurring_id = ANY(?::int[]) AND recur_key = ANY(?::text[])', [
      due.map((x) => x.r.id),
      [...new Set(due.map((x) => x.period.key))],
    ])).map((x) => `${x.recurring_id}:${x.recur_key}`),
  );
  const missing = due.filter((x) => !have.has(`${x.r.id}:${x.period.key}`));
  if (!missing.length) return 0;
  const { stepsFor } = await import('./routes/sops.js');
  let created = 0;
  await db.tx(async (tx) => {
    for (const { r, period } of missing) {
      const task = await tx.get(
        `INSERT INTO tasks (project_id, title, description, type, priority, assignee_id, reporter_id, reviewer_id, start_date, due_date, track, recurring_id, recur_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id`,
        [r.project_id, r.title, r.description || '', r.type, r.priority, r.assignee_id, r.created_by ?? r.assignee_id, r.reviewer_id, period.key.length === 7 ? `${period.key}-01` : period.key, period.due, r.track || '', r.id, period.key],
      );
      if (!task) continue; // another instance got there first
      created++;
      const steps = await stepsFor(tx, r.type, r.language === 'ar' ? 'ar' : 'en');
      if (steps.length) {
        await tx.run(
          'INSERT INTO checklist_items (task_id, text, required, position) SELECT ?, s.text, s.required::int, s.pos - 1 FROM unnest(?::text[], ?::boolean[]) WITH ORDINALITY AS s(text, required, pos)',
          [task.id, steps.map((s) => s.text), steps.map((s) => s.required)],
        );
      }
      await tx.run("INSERT INTO activity (task_id, project_id, user_id, action, detail) VALUES (?, ?, NULL, 'created', ?)", [task.id, r.project_id, r.title]);
      await tx.run("INSERT INTO notifications (user_id, type, message, task_id, params) VALUES (?, 'recurring_task', ?, ?, ?)", [
        r.assignee_id,
        `Your recurring task "${r.title}" is ready`,
        task.id,
        JSON.stringify({ title: r.title, date: period.due }),
      ]);
    }
  });
  return created;
}
