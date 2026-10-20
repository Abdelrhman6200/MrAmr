import { Router } from 'express';
import { transaction } from '../db.js';
import { badRequest, forbidden, notFound, oneOf, optionalDate, optionalId, requiredString } from '../http.js';
import { DEPARTMENTS, PROJECT_STATUSES, departmentOf, isManagerRole, keys } from '../meta.js';

const PROJECT_COLORS = ['#16a34a', '#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#f97316', '#ec4899', '#8b5cf6', '#eab308'];

export default function projectRoutes({ db, access }) {
  const r = Router();

  const SELECT = `
    SELECT p.*, o.name AS owner_name,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done' AND t.due_date < date('now','localtime')) AS overdue_count
    FROM projects p JOIN users o ON o.id = p.owner_id`;

  const members = db.prepare(
    `SELECT u.id, u.name, u.role, u.avatar_color, u.title FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY u.name`,
  );

  function load(id) {
    const p = db.prepare(`${SELECT} WHERE p.id = ?`).get(id);
    if (!p) throw notFound('Project not found');
    return p;
  }

  function loadVisible(req) {
    const p = load(Number(req.params.id));
    if (!access.canViewProject(req.user, p)) throw notFound('Project not found');
    return p;
  }

  const decorate = (req, p) => ({ ...p, members: members.all(p.id), can_manage: access.canManageProject(req.user, p) });

  function setMembers(projectId, ids, ownerId) {
    const unique = [...new Set([ownerId, ...ids.map(Number)])];
    const exists = db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1');
    for (const id of unique) if (!exists.get(id)) throw badRequest(`User ${id} not found`);
    db.prepare('DELETE FROM project_members WHERE project_id = ?').run(projectId);
    const ins = db.prepare('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)');
    for (const id of unique) ins.run(projectId, id);
  }

  r.get('/', (req, res) => {
    const scope = access.projectScope(req.user);
    const where = [scope.sql];
    const params = [...scope.params];
    if (req.query.status) {
      where.push('p.status = ?');
      params.push(req.query.status);
    } else if (req.query.include_archived !== '1') {
      where.push("p.status != 'archived'");
    }
    if (req.query.department) {
      where.push('p.department = ?');
      params.push(req.query.department);
    }
    const rows = db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY p.status = 'completed', p.due_date IS NULL, p.due_date, p.name`).all(...params);
    res.json(rows.map((p) => decorate(req, p)));
  });

  r.get('/:id', (req, res) => {
    const p = loadVisible(req);
    const activity = db
      .prepare(
        `SELECT a.*, u.name AS user_name, t.title AS task_title FROM activity a LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN tasks t ON t.id = a.task_id WHERE a.project_id = ? ORDER BY a.id DESC LIMIT 30`,
      )
      .all(p.id);
    res.json({ ...decorate(req, p), activity });
  });

  r.post('/', (req, res) => {
    if (!isManagerRole(req.user.role)) throw forbidden('Only managers can create projects');
    const b = req.body || {};
    const name = requiredString(b.name, 'name', 200);
    const department = b.department ? oneOf(b.department, Object.keys(DEPARTMENTS), 'department') : departmentOf(req.user.role);
    const status = b.status ? oneOf(b.status, keys(PROJECT_STATUSES), 'status') : 'active';
    const ownerId = optionalId(b.owner_id, 'owner_id') ?? req.user.id;
    if (ownerId !== req.user.id && !access.managesUser(req.user, ownerId)) throw forbidden('You can only make yourself or your reports the owner');
    const color = b.color || PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];
    const id = transaction(db, () => {
      const info = db
        .prepare('INSERT INTO projects (name, description, department, owner_id, status, start_date, due_date, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(name, String(b.description || ''), department, ownerId, status, optionalDate(b.start_date, 'start_date') ?? null, optionalDate(b.due_date, 'due_date') ?? null, color);
      const pid = Number(info.lastInsertRowid);
      setMembers(pid, Array.isArray(b.member_ids) ? b.member_ids : [], ownerId);
      db.prepare('INSERT INTO activity (project_id, user_id, action, detail) VALUES (?, ?, ?, ?)').run(pid, req.user.id, 'project_created', name);
      return pid;
    });
    res.status(201).json(decorate(req, load(id)));
  });

  r.patch('/:id', (req, res) => {
    const p = loadVisible(req);
    if (!access.canManageProject(req.user, p)) throw forbidden('Only the project owner or their managers can edit this project');
    const b = req.body || {};
    const f = {};
    if (b.name !== undefined) f.name = requiredString(b.name, 'name', 200);
    if (b.description !== undefined) f.description = String(b.description || '');
    if (b.department !== undefined) f.department = oneOf(b.department, Object.keys(DEPARTMENTS), 'department');
    if (b.status !== undefined) f.status = oneOf(b.status, keys(PROJECT_STATUSES), 'status');
    if (b.start_date !== undefined) f.start_date = optionalDate(b.start_date, 'start_date');
    if (b.due_date !== undefined) f.due_date = optionalDate(b.due_date, 'due_date');
    if (b.color !== undefined) f.color = String(b.color);
    if (b.owner_id !== undefined) {
      const ownerId = optionalId(b.owner_id, 'owner_id');
      if (!ownerId) throw badRequest('owner_id is required');
      if (ownerId !== req.user.id && !access.managesUser(req.user, ownerId) && ownerId !== p.owner_id) {
        throw forbidden('You can only hand the project to yourself or your reports');
      }
      f.owner_id = ownerId;
    }
    transaction(db, () => {
      const k = Object.keys(f);
      if (k.length) db.prepare(`UPDATE projects SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`).run(...k.map((x) => f[x]), p.id);
      if (Array.isArray(b.member_ids)) setMembers(p.id, b.member_ids, f.owner_id ?? p.owner_id);
      else if (f.owner_id) db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)').run(p.id, f.owner_id);
      if (f.status && f.status !== p.status) {
        db.prepare('INSERT INTO activity (project_id, user_id, action, detail) VALUES (?, ?, ?, ?)').run(p.id, req.user.id, 'project_status', f.status);
      }
    });
    res.json(decorate(req, load(p.id)));
  });

  r.delete('/:id', (req, res) => {
    const p = loadVisible(req);
    if (!access.canManageProject(req.user, p)) throw forbidden();
    // Tasks survive (project_id is set to NULL) so no work history is lost.
    db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
    res.status(204).end();
  });

  return r;
}
