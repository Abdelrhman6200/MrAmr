import { Router } from 'express';
import { TASK_SELECT, PRIORITY_ORDER } from './tasks.js';
import { DEPARTMENTS, ROLES, isManagerRole } from '../meta.js';

export default function dashboardRoutes({ db, access }) {
  const r = Router();

  r.get('/', (req, res) => {
    const me = req.user;
    const scope = access.taskScope(me);
    const mineCounts = db.prepare('SELECT status, COUNT(*) AS n FROM tasks WHERE assignee_id = ? GROUP BY status').all(me.id);
    const overdue = db
      .prepare(`${TASK_SELECT} WHERE t.assignee_id = ? AND t.status != 'done' AND t.due_date < date('now','localtime') ORDER BY t.due_date LIMIT 20`)
      .all(me.id);
    const upcoming = db
      .prepare(
        `${TASK_SELECT} WHERE t.assignee_id = ? AND t.status != 'done' AND (t.due_date IS NULL OR t.due_date >= date('now','localtime'))
         ORDER BY t.due_date IS NULL, t.due_date, ${PRIORITY_ORDER} LIMIT 10`,
      )
      .all(me.id);
    const reviewQueue = db.prepare(`${TASK_SELECT} WHERE t.reviewer_id = ? AND t.status = 'in_review' ORDER BY t.updated_at`).all(me.id);
    const waitingOnOthers = db
      .prepare(`${TASK_SELECT} WHERE t.reporter_id = ? AND (t.assignee_id IS NULL OR t.assignee_id != ?) AND t.status != 'done' ORDER BY t.due_date IS NULL, t.due_date LIMIT 10`)
      .all(me.id, me.id);

    let team = [];
    if (isManagerRole(me.role)) {
      const ids = [...access.reportsOf(me.id)];
      if (ids.length) {
        team = db
          .prepare(
            `SELECT u.id, u.name, u.role, u.avatar_color,
              SUM(CASE WHEN t.status IS NOT NULL AND t.status != 'done' THEN 1 ELSE 0 END) AS open,
              SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
              SUM(CASE WHEN t.status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
              SUM(CASE WHEN t.status != 'done' AND t.due_date < date('now','localtime') THEN 1 ELSE 0 END) AS overdue,
              SUM(CASE WHEN t.status = 'done' AND t.completed_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS done_week
             FROM users u LEFT JOIN tasks t ON t.assignee_id = u.id
             WHERE u.active = 1 AND u.id IN (${ids.map(() => '?').join(',')})
             GROUP BY u.id ORDER BY overdue DESC, open DESC`,
          )
          .all(...ids);
      }
    }

    const activity = db
      .prepare(
        `SELECT a.*, u.name AS user_name, t.title AS task_title FROM activity a
         JOIN tasks t ON t.id = a.task_id LEFT JOIN users u ON u.id = a.user_id
         WHERE ${scope.sql} ORDER BY a.id DESC LIMIT 15`,
      )
      .all(...scope.params);

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
  r.get('/reports', (req, res) => {
    const scope = access.taskScope(req.user);
    const rows = db
      .prepare(
        `SELECT t.status, t.priority, t.type, t.due_date, t.completed_at, t.created_at, a.role AS assignee_role
         FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id WHERE ${scope.sql}`,
      )
      .all(...scope.params);
    // Same clock as the SQL overdue checks (date('now','localtime')).
    const today = db.prepare("SELECT date('now', 'localtime') AS d").get().d;

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

    const pscope = access.projectScope(req.user);
    const projects = db
      .prepare(
        `SELECT p.id, p.name, p.color, p.status, p.department, p.due_date,
          (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS total,
          (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done,
          (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done' AND t.due_date < date('now','localtime')) AS overdue
         FROM projects p WHERE ${pscope.sql} AND p.status != 'archived' ORDER BY p.name`,
      )
      .all(...pscope.params);

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

  return r;
}

// Stored timestamps are UTC 'YYYY-MM-DD HH:MM:SS' (see time.js); convert to ISO to compare with JS dates.
const isoOf = (s) => (s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
