import { Router } from 'express';
import { TASK_SELECT, PRIORITY_ORDER } from './tasks.js';
import { DEPARTMENTS, ROLES } from '../meta.js';
import { peopleKpis } from '../kpis.js';
import { DAY, localDate, utcAgo } from '../time.js';

export default function dashboardRoutes({ db, access }) {
  const r = Router();

  r.get('/', async (req, res) => {
    const me = req.user;
    const today = localDate();
    const scope = await access.taskScope(me);
    const ids = access.actsAsManager(me) ? [...access.reportsOf(me.id)] : [];
    const [mineCounts, overdue, upcoming, reviewQueue, waitingOnOthers, team, activity] = await Promise.all([
      db.all('SELECT status, COUNT(*) AS n FROM tasks WHERE assignee_id = ? GROUP BY status', [me.id]),
      db.all(`${TASK_SELECT} WHERE t.assignee_id = ? AND t.status != 'done' AND t.due_date < ? ORDER BY t.due_date LIMIT 20`, [me.id, today]),
      db.all(
        `${TASK_SELECT} WHERE t.assignee_id = ? AND t.status != 'done' AND (t.due_date IS NULL OR t.due_date >= ?)
         ORDER BY t.due_date IS NULL, t.due_date, ${PRIORITY_ORDER} LIMIT 10`,
        [me.id, today],
      ),
      // Including the reviews of managers this person is acting for today.
      db.all(`${TASK_SELECT} WHERE t.reviewer_id = ANY(?::int[]) AND t.status = 'in_review' ORDER BY t.updated_at`, [[me.id, ...access.covering(me.id)]]),
      db.all(
        `${TASK_SELECT} WHERE t.reporter_id = ? AND (t.assignee_id IS NULL OR t.assignee_id != ?) AND t.status != 'done'
         ORDER BY t.due_date IS NULL, t.due_date LIMIT 10`,
        [me.id, me.id],
      ),
      ids.length
        ? db.all(
            `SELECT u.id, u.name, u.role, u.avatar_color,
              COUNT(*) FILTER (WHERE t.status IS NOT NULL AND t.status != 'done') AS open,
              COUNT(*) FILTER (WHERE t.status = 'in_progress') AS in_progress,
              COUNT(*) FILTER (WHERE t.status = 'blocked') AS blocked,
              COUNT(*) FILTER (WHERE t.status != 'done' AND t.due_date < ?) AS overdue,
              COUNT(*) FILTER (WHERE t.status = 'done' AND t.completed_at >= ?) AS done_week
             FROM users u LEFT JOIN tasks t ON t.assignee_id = u.id
             WHERE u.active = 1 AND u.id = ANY(?::int[])
             GROUP BY u.id ORDER BY overdue DESC, open DESC`,
            [today, utcAgo(7 * DAY), ids],
          )
        : [],
      db.all(
        `SELECT a.*, u.name AS user_name, t.title AS task_title FROM activity a
         JOIN tasks t ON t.id = a.task_id LEFT JOIN users u ON u.id = a.user_id
         WHERE ${scope.sql} ORDER BY a.id DESC LIMIT 15`,
        scope.params,
      ),
    ]);

    res.json({
      counts: Object.fromEntries(mineCounts.map((c) => [c.status, c.n])),
      overdue,
      upcoming,
      reviewQueue,
      waitingOnOthers,
      team,
      activity,
    });
  });

  // Aggregates across everything the user can see.
  r.get('/reports', async (req, res) => {
    const today = localDate();
    const scope = await access.taskScope(req.user);
    const pscope = await access.projectScope(req.user);
    const [rows, projects] = await Promise.all([
      db.all(
        `SELECT t.status, t.priority, t.type, t.due_date, t.completed_at, t.created_at, a.role AS assignee_role
         FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id WHERE ${scope.sql}`,
        scope.params,
      ),
      db.all(
        `SELECT p.id, p.name, p.color, p.status, p.department, p.due_date,
          (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS total,
          (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done,
          (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done' AND t.due_date < ?) AS overdue
         FROM projects p WHERE ${pscope.sql} AND p.status != 'archived' ORDER BY p.name`,
        [today, ...pscope.params],
      ),
    ]);

    const byDept = {};
    for (const key of Object.keys(DEPARTMENTS)) byDept[key] = { department: key, total: 0, done: 0, open: 0, overdue: 0, blocked: 0 };
    const byStatus = {};
    const byPriority = {};
    const byType = {};
    for (const t of rows) {
      const dept = ROLES[t.assignee_role]?.department;
      const d = dept && byDept[dept];
      const overdue = t.status !== 'done' && t.due_date && t.due_date < today;
      if (d) {
        d.total++;
        if (t.status === 'done') d.done++;
        else d.open++;
        if (overdue) d.overdue++;
        if (t.status === 'blocked') d.blocked++;
      }
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      if (t.status !== 'done') byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
      byType[t.type] = (byType[t.type] || 0) + 1;
    }

    // Created vs completed per week, last 8 weeks.
    const weeks = [];
    const now = new Date();
    for (let i = 7; i >= 0; i--) {
      const end = new Date(now);
      end.setDate(now.getDate() - i * 7);
      const start = new Date(end);
      start.setDate(end.getDate() - 7);
      const s = start.toISOString();
      const e = end.toISOString();
      weeks.push({
        week: end.toISOString().slice(0, 10),
        created: rows.filter((t) => isoOf(t.created_at) > s && isoOf(t.created_at) <= e).length,
        completed: rows.filter((t) => t.completed_at && isoOf(t.completed_at) > s && isoOf(t.completed_at) <= e).length,
      });
    }

    res.json({
      total: rows.length,
      byDepartment: Object.values(byDept).filter((d) => d.total > 0),
      byStatus,
      byPriority,
      byType,
      weeks,
      projects,
    });
  });

  // Performance per person: the user's team (everyone for leadership).
  r.get('/kpis', async (req, res) => {
    const days = Math.min(Math.max(Math.floor(Number(req.query.days)) || 30, 7), 365);
    const me = req.user;
    const ids = me.role === 'ceo' || access.canAdminUsers(me) ? (await db.all('SELECT id FROM users WHERE active = 1')).map((u) => u.id) : [me.id, ...access.reportsOf(me.id)];
    res.json({ days, people: await peopleKpis(db, ids, days) });
  });

  return r;
}

// Stored timestamps are UTC 'YYYY-MM-DD HH:MM:SS' (see time.js); convert to ISO to compare with JS dates.
const isoOf = (s) => (s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
