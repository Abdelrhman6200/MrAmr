// The weekly summary: from Saturday, every manager and team leader gets one
// notification about their team's last 7 days (done, on time, late now). As a
// notification it shows in the app, and goes out by email like any
// other. weekly_digests keeps it to one per person per week.
import { isManagerRole } from './meta.js';
import { peopleKpis } from './kpis.js';
import { weekStart } from './weekly.js';

export async function sendWeeklyDigests(db, today) {
  const week = weekStart(today);
  const users = await db.all('SELECT id, role, manager_id FROM users WHERE active = 1');
  const children = new Map();
  for (const u of users) if (u.manager_id) children.set(u.manager_id, [...(children.get(u.manager_id) || []), u.id]);
  const below = (id) => {
    const out = [];
    const stack = [...(children.get(id) || [])];
    while (stack.length) {
      const x = stack.pop();
      if (out.includes(x)) continue;
      out.push(x);
      stack.push(...(children.get(x) || []));
    }
    return out;
  };
  const leads = users.filter((u) => (isManagerRole(u.role) || children.has(u.id)) && below(u.id).length);
  if (!leads.length) return 0;
  const done = new Set((await db.all('SELECT user_id FROM weekly_digests WHERE week = ?', [week])).map((x) => x.user_id));
  let sent = 0;
  for (const lead of leads.filter((u) => !done.has(u.id))) {
    // Claim first, so two instances never both send it.
    const claimed = await db.get('INSERT INTO weekly_digests (user_id, week) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING user_id', [lead.id, week]);
    if (!claimed) continue;
    const team = await peopleKpis(db, below(lead.id), 7);
    const sum = (k) => team.reduce((n, p) => n + (p[k] || 0), 0);
    const withDates = team.filter((p) => p.on_time_pct != null);
    const onTime = withDates.length ? Math.round(withDates.reduce((n, p) => n + p.on_time_pct, 0) / withDates.length) : null;
    const late = team.filter((p) => p.overdue > 0).sort((a, b) => b.overdue - a.overdue).slice(0, 3);
    const params = {
      done: sum('done'),
      overdue: sum('overdue'),
      on_time: onTime ?? '—',
      late: late.map((p) => `${p.name} (${p.overdue})`).join('، ') || '—',
    };
    await db.run("INSERT INTO notifications (user_id, type, message, link, params) VALUES (?, 'weekly_summary', ?, '/reports?tab=people', ?)", [
      lead.id,
      `Last week your team finished ${params.done} tasks (${params.on_time}% on time); ${params.overdue} are late now. Most late: ${params.late}`,
      JSON.stringify(params),
    ]);
    sent++;
  }
  return sent;
}
