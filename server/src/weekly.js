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
