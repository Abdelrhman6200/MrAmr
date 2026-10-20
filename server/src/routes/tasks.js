import { Router } from 'express';
import { transaction } from '../db.js';
import { badRequest, forbidden, notFound, oneOf, optionalDate, optionalId, requiredString } from '../http.js';
import { PRIORITIES, ROLES, STATUSES, TASK_TYPES, keys } from '../meta.js';

export const TASK_SELECT = `
  SELECT t.*, p.name AS project_name, p.color AS project_color,
    a.name AS assignee_name, a.avatar_color AS assignee_color, a.role AS assignee_role,
    r.name AS reporter_name, rv.name AS reviewer_name,
    (SELECT COUNT(*) FROM checklist_items c WHERE c.task_id = t.id) AS checklist_total,
    (SELECT COUNT(*) FROM checklist_items c WHERE c.task_id = t.id AND c.done = 1) AS checklist_done,
    (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) AS comment_count
  FROM tasks t
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN users a ON a.id = t.assignee_id
  LEFT JOIN users r ON r.id = t.reporter_id
  LEFT JOIN users rv ON rv.id = t.reviewer_id`;

export const PRIORITY_ORDER = `CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;

const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]));

function normaliseTags(tags) {
  if (tags === undefined) return undefined;
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20).join(',');
}

export default function taskRoutes({ db, access }) {
  const r = Router();
  const userById = db.prepare('SELECT id, name, active FROM users WHERE id = ?');
  const projectById = db.prepare('SELECT * FROM projects WHERE id = ?');
  const logStmt = db.prepare('INSERT INTO activity (task_id, project_id, user_id, action, detail) VALUES (?, ?, ?, ?, ?)');
  const notifyStmt = db.prepare('INSERT INTO notifications (user_id, type, message, task_id) VALUES (?, ?, ?, ?)');

  const log = (task, userId, action, detail = '') => logStmt.run(task.id, task.project_id ?? null, userId, action, detail);
  const notify = (actor, userId, type, message, taskId) => {
    if (userId != null && userId !== actor.id) notifyStmt.run(userId, type, message, taskId);
  };

  const raw = (id) => db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  const full = (id) => db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id);

  function loadVisible(req, id = req.params.id) {
    const t = raw(Number(id));
    if (!t || !access.canViewTask(req.user, t)) throw notFound('Task not found');
    return t;
  }

  function loadEditable(req) {
    const t = loadVisible(req);
    if (!access.canEditTask(req.user, t)) throw forbidden('You cannot edit this task');
    return t;
  }

  const perms = (user, t) => ({
    can_edit: access.canEditTask(user, t),
    can_delete: access.canDeleteTask(user, t),
    can_review: access.canReviewTask(user, t),
  });

  function checkAssignee(user, assigneeId, projectId) {
    if (assigneeId == null) return;
    const u = userById.get(assigneeId);
    if (!u || !u.active) throw badRequest('Assignee not found');
    if (!access.assignableIds(user, projectId).has(assigneeId)) {
      throw forbidden(`You cannot assign work to ${u.name}. You can assign to yourself, your team, project members, or any manager.`);
    }
  }

  function checkReviewer(reviewerId) {
    if (reviewerId == null) return;
    const u = userById.get(reviewerId);
    if (!u || !u.active) throw badRequest('Reviewer not found');
  }

  function checkProject(user, projectId) {
    if (projectId == null) return;
    const p = projectById.get(projectId);
    if (!p || !access.canViewProject(user, p)) throw badRequest('Project not found');
  }

  // ---- list -------------------------------------------------------------
  r.get('/', (req, res) => {
    const q = req.query;
    const scope = access.taskScope(req.user);
    const where = [scope.sql];
    const params = [...scope.params];
    const add = (sql, ...p) => {
      where.push(sql);
      params.push(...p);
    };

    switch (q.scope) {
      case 'mine':
        add('t.assignee_id = ?', req.user.id);
        break;
      case 'created':
        add('t.reporter_id = ?', req.user.id);
        break;
      case 'review':
        add("t.reviewer_id = ? AND t.status = 'in_review'", req.user.id);
        break;
      case 'team': {
        const team = [...access.reportsOf(req.user.id)];
        if (!team.length) add('0');
        else add(`t.assignee_id IN (${team.map(() => '?').join(',')})`, ...team);
        break;
      }
    }
    if (q.status) {
      const list = String(q.status).split(',');
      add(`t.status IN (${list.map(() => '?').join(',')})`, ...list);
    }
    if (q.open === '1') add("t.status != 'done'");
    if (q.priority) add('t.priority = ?', q.priority);
    if (q.type) add('t.type = ?', q.type);
    if (q.project_id === 'none') add('t.project_id IS NULL');
    else if (q.project_id) add('t.project_id = ?', Number(q.project_id));
    if (q.assignee_id === 'none') add('t.assignee_id IS NULL');
    else if (q.assignee_id) add('t.assignee_id = ?', q.assignee_id === 'me' ? req.user.id : Number(q.assignee_id));
    if (q.department) add('a.role IN (SELECT value FROM json_each(?))', JSON.stringify(rolesInDept(q.department)));
    if (q.tag) add("(',' || t.tags || ',') LIKE ?", `%,${String(q.tag).toLowerCase()},%`);
    if (q.q) add('(t.title LIKE ? OR t.description LIKE ?)', `%${q.q}%`, `%${q.q}%`);
    if (q.due === 'overdue') add("t.status != 'done' AND t.due_date < date('now','localtime')");
    if (q.due === 'today') add("t.due_date = date('now','localtime')");
    if (q.due === 'week') add("t.status != 'done' AND t.due_date BETWEEN date('now','localtime') AND date('now','localtime','+7 days')");
    if (q.from) add('t.due_date >= ?', q.from);
    if (q.to) add('t.due_date <= ?', q.to);

    const limit = Math.min(Number(q.limit) || 500, 1000);
    const rows = db
      .prepare(`${TASK_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.status = 'done', ${PRIORITY_ORDER}, t.due_date IS NULL, t.due_date, t.id DESC LIMIT ${limit}`)
      .all(...params);
    res.json(rows);
  });

  // ---- detail -----------------------------------------------------------
  r.get('/:id', (req, res) => {
    const t = loadVisible(req);
    const checklist = db.prepare('SELECT * FROM checklist_items WHERE task_id = ? ORDER BY position, id').all(t.id);
    const comments = db
      .prepare('SELECT c.*, u.name AS user_name, u.avatar_color FROM comments c JOIN users u ON u.id = c.user_id WHERE c.task_id = ? ORDER BY c.id')
      .all(t.id);
    const activity = db
      .prepare('SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.task_id = ? ORDER BY a.id DESC LIMIT 50')
      .all(t.id);
    res.json({ ...full(t.id), checklist: checklist.map((c) => ({ ...c, done: !!c.done })), comments, activity, ...perms(req.user, t) });
  });

  // ---- create -----------------------------------------------------------
  r.post('/', (req, res) => {
    const b = req.body || {};
    const title = requiredString(b.title, 'title', 300);
    const projectId = optionalId(b.project_id, 'project_id') ?? null;
    checkProject(req.user, projectId);
    const assigneeId = b.assignee_id === undefined ? req.user.id : optionalId(b.assignee_id, 'assignee_id');
    checkAssignee(req.user, assigneeId, projectId);
    const reviewerId = optionalId(b.reviewer_id, 'reviewer_id') ?? null;
    checkReviewer(reviewerId);
    const status = b.status ? oneOf(b.status, keys(STATUSES), 'status') : 'todo';
    if (status === 'in_review' && !reviewerId) throw badRequest('Pick a reviewer before sending a task to review');
    if (status === 'done' && reviewerId) throw badRequest('Tasks with a reviewer must be approved before they are done');

    const id = transaction(db, () => {
      const info = db
        .prepare(
          `INSERT INTO tasks (project_id, title, description, type, status, priority, assignee_id, reporter_id, reviewer_id, start_date, due_date, estimate_hours, tags, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          projectId,
          title,
          String(b.description || ''),
          b.type ? oneOf(b.type, keys(TASK_TYPES), 'type') : 'general',
          status,
          b.priority ? oneOf(b.priority, keys(PRIORITIES), 'priority') : 'medium',
          assigneeId ?? null,
          req.user.id,
          reviewerId,
          optionalDate(b.start_date, 'start_date') ?? null,
          optionalDate(b.due_date, 'due_date') ?? null,
          b.estimate_hours === undefined || b.estimate_hours === '' || b.estimate_hours === null ? null : Number(b.estimate_hours),
          normaliseTags(b.tags) ?? '',
          status === 'done' ? new Date().toISOString() : null,
        );
      const task = raw(Number(info.lastInsertRowid));
      log(task, req.user.id, 'created', title);
      notify(req.user, assigneeId, 'assigned', `${req.user.name} assigned you "${title}"`, task.id);
      if (status === 'in_review') notify(req.user, reviewerId, 'review_requested', `${req.user.name} requested your review on "${title}"`, task.id);
      if (Array.isArray(b.checklist)) {
        const ins = db.prepare('INSERT INTO checklist_items (task_id, text, position) VALUES (?, ?, ?)');
        b.checklist.filter((s) => String(s).trim()).forEach((s, i) => ins.run(task.id, String(s).trim(), i));
      }
      return task.id;
    });
    res.status(201).json({ ...full(id), ...perms(req.user, raw(id)) });
  });

  // ---- update -----------------------------------------------------------
  r.patch('/:id', (req, res) => {
    const t = loadEditable(req);
    const b = req.body || {};
    const f = {};
    if (b.title !== undefined) f.title = requiredString(b.title, 'title', 300);
    if (b.description !== undefined) f.description = String(b.description || '');
    if (b.type !== undefined) f.type = oneOf(b.type, keys(TASK_TYPES), 'type');
    if (b.priority !== undefined) f.priority = oneOf(b.priority, keys(PRIORITIES), 'priority');
    if (b.start_date !== undefined) f.start_date = optionalDate(b.start_date, 'start_date');
    if (b.due_date !== undefined) f.due_date = optionalDate(b.due_date, 'due_date');
    if (b.estimate_hours !== undefined) f.estimate_hours = b.estimate_hours === '' || b.estimate_hours === null ? null : Number(b.estimate_hours);
    if (b.tags !== undefined) f.tags = normaliseTags(b.tags);
    if (b.project_id !== undefined) {
      f.project_id = optionalId(b.project_id, 'project_id');
      checkProject(req.user, f.project_id);
    }
    if (b.assignee_id !== undefined) {
      f.assignee_id = optionalId(b.assignee_id, 'assignee_id');
      if (f.assignee_id !== t.assignee_id) checkAssignee(req.user, f.assignee_id, f.project_id ?? t.project_id);
    }
    if (b.reviewer_id !== undefined) {
      f.reviewer_id = optionalId(b.reviewer_id, 'reviewer_id');
      checkReviewer(f.reviewer_id);
    }
    const reviewerId = f.reviewer_id !== undefined ? f.reviewer_id : t.reviewer_id;
    if (b.status !== undefined) {
      f.status = oneOf(b.status, keys(STATUSES), 'status');
      if (f.status === 'in_review' && !reviewerId) throw badRequest('Pick a reviewer before sending a task to review');
      if (f.status === 'done' && t.status !== 'done' && reviewerId && !access.canReviewTask(req.user, { ...t, reviewer_id: reviewerId })) {
        throw badRequest('This task has a reviewer — send it to review so they can approve it');
      }
      if (f.status === 'done' && t.status !== 'done') f.completed_at = new Date().toISOString();
      if (f.status !== 'done') f.completed_at = null;
    }

    const changed = Object.keys(f).filter((k) => f[k] !== t[k]);
    if (!changed.length) return res.json({ ...full(t.id), ...perms(req.user, t) });

    transaction(db, () => {
      db.prepare(`UPDATE tasks SET ${changed.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(
        ...changed.map((k) => f[k]),
        t.id,
      );
      const updated = raw(t.id);
      const title = updated.title;
      for (const k of changed) {
        if (k === 'completed_at' || k === 'description') continue;
        if (k === 'status') log(updated, req.user.id, 'status', `${STATUS_LABEL[t.status]} → ${STATUS_LABEL[f.status]}`);
        else if (k === 'assignee_id') log(updated, req.user.id, 'assigned', f.assignee_id ? userById.get(f.assignee_id).name : 'Unassigned');
        else if (k === 'reviewer_id') log(updated, req.user.id, 'reviewer', f.reviewer_id ? userById.get(f.reviewer_id).name : 'None');
        else if (k === 'project_id') log(updated, req.user.id, 'updated', `project: ${f.project_id ? projectById.get(f.project_id).name : 'none'}`);
        else log(updated, req.user.id, 'updated', `${k.replace('_', ' ')}${f[k] ? `: ${f[k]}` : ' cleared'}`);
      }
      if (changed.includes('description')) log(updated, req.user.id, 'updated', 'description');

      if (changed.includes('assignee_id')) notify(req.user, f.assignee_id, 'assigned', `${req.user.name} assigned you "${title}"`, t.id);
      if (changed.includes('status')) {
        if (f.status === 'in_review') notify(req.user, reviewerId, 'review_requested', `${req.user.name} requested your review on "${title}"`, t.id);
        if (f.status === 'done') {
          notify(req.user, t.reporter_id, 'completed', `${req.user.name} completed "${title}"`, t.id);
          notify(req.user, updated.assignee_id, 'completed', `${req.user.name} marked "${title}" done`, t.id);
        }
        if (f.status === 'blocked') notify(req.user, t.reporter_id, 'blocked', `"${title}" is blocked`, t.id);
      }
    });
    res.json({ ...full(t.id), ...perms(req.user, raw(t.id)) });
  });

  r.delete('/:id', (req, res) => {
    const t = loadVisible(req);
    if (!access.canDeleteTask(req.user, t)) throw forbidden('Only the creator, their managers or the project owner can delete this task');
    db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
    res.status(204).end();
  });

  // ---- review workflow ---------------------------------------------------
  r.post('/:id/review', (req, res) => {
    const t = loadVisible(req);
    if (!access.canReviewTask(req.user, t)) throw forbidden('Only the reviewer can approve this task');
    if (t.status !== 'in_review') throw badRequest('Task is not waiting for review');
    const decision = oneOf(req.body?.decision, ['approve', 'changes'], 'decision');
    const comment = String(req.body?.comment || '').trim();
    if (decision === 'changes' && !comment) throw badRequest('Explain what needs to change');
    transaction(db, () => {
      if (decision === 'approve') {
        db.prepare("UPDATE tasks SET status = 'done', completed_at = ?, updated_at = datetime('now') WHERE id = ?").run(new Date().toISOString(), t.id);
        log(t, req.user.id, 'approved', comment);
        notify(req.user, t.assignee_id, 'approved', `${req.user.name} approved "${t.title}"`, t.id);
        notify(req.user, t.reporter_id, 'approved', `${req.user.name} approved "${t.title}"`, t.id);
      } else {
        db.prepare("UPDATE tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?").run(t.id);
        log(t, req.user.id, 'changes_requested', comment);
        notify(req.user, t.assignee_id, 'changes_requested', `${req.user.name} requested changes on "${t.title}"`, t.id);
      }
      if (comment) {
        const prefix = decision === 'approve' ? '✅ Approved' : '🔁 Changes requested';
        db.prepare('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)').run(t.id, req.user.id, `${prefix}: ${comment}`);
      }
    });
    res.json({ ...full(t.id), ...perms(req.user, raw(t.id)) });
  });

  // ---- comments ----------------------------------------------------------
  r.post('/:id/comments', (req, res) => {
    const t = loadVisible(req);
    const body = requiredString(req.body?.body, 'comment', 5000);
    const info = db.prepare('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)').run(t.id, req.user.id, body);
    for (const uid of new Set([t.assignee_id, t.reporter_id, t.reviewer_id])) {
      notify(req.user, uid, 'comment', `${req.user.name} commented on "${t.title}"`, t.id);
    }
    const c = db
      .prepare('SELECT c.*, u.name AS user_name, u.avatar_color FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?')
      .get(Number(info.lastInsertRowid));
    res.status(201).json(c);
  });

  r.delete('/:id/comments/:commentId', (req, res) => {
    const t = loadVisible(req);
    const c = db.prepare('SELECT * FROM comments WHERE id = ? AND task_id = ?').get(Number(req.params.commentId), t.id);
    if (!c) throw notFound('Comment not found');
    if (c.user_id !== req.user.id && req.user.role !== 'ceo') throw forbidden('You can only delete your own comments');
    db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
    res.status(204).end();
  });

  // ---- checklist ---------------------------------------------------------
  const item = (t, id) => {
    const c = db.prepare('SELECT * FROM checklist_items WHERE id = ? AND task_id = ?').get(Number(id), t.id);
    if (!c) throw notFound('Checklist item not found');
    return c;
  };

  r.post('/:id/checklist', (req, res) => {
    const t = loadEditable(req);
    const text = requiredString(req.body?.text, 'text', 500);
    const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM checklist_items WHERE task_id = ?').get(t.id).p;
    const info = db.prepare('INSERT INTO checklist_items (task_id, text, position) VALUES (?, ?, ?)').run(t.id, text, pos);
    const c = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(Number(info.lastInsertRowid));
    res.status(201).json({ ...c, done: !!c.done });
  });

  r.patch('/:id/checklist/:itemId', (req, res) => {
    const t = loadEditable(req);
    const c = item(t, req.params.itemId);
    const text = req.body?.text !== undefined ? requiredString(req.body.text, 'text', 500) : c.text;
    const done = req.body?.done !== undefined ? (req.body.done ? 1 : 0) : c.done;
    db.prepare('UPDATE checklist_items SET text = ?, done = ? WHERE id = ?').run(text, done, c.id);
    res.json({ ...c, text, done: !!done });
  });

  r.delete('/:id/checklist/:itemId', (req, res) => {
    const t = loadEditable(req);
    const c = item(t, req.params.itemId);
    db.prepare('DELETE FROM checklist_items WHERE id = ?').run(c.id);
    res.status(204).end();
  });

  return r;
}

function rolesInDept(dept) {
  return Object.entries(ROLES)
    .filter(([, r]) => r.department === dept)
    .map(([k]) => k);
}
