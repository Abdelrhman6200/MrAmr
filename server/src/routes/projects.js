import { Router } from 'express';
import { badRequest, forbidden, idParam, notFound, oneOf, optionalDate, optionalId, requiredString } from '../http.js';
import { DEPARTMENTS, PROJECT_STATUSES, departmentOf, isManagerRole, keys } from '../meta.js';
import { localDate } from '../time.js';

const PROJECT_COLORS = ['#16a34a', '#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#f97316', '#ec4899', '#8b5cf6', '#eab308'];

// The first placeholder is today's local date.
const SELECT = `
  SELECT p.*, o.name AS owner_name,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done' AND t.due_date < ?) AS overdue_count
  FROM projects p JOIN users o ON o.id = p.owner_id`;

export default function projectRoutes({ db, access }) {
  const r = Router();

  const members = (id) =>
    db.all(
      `SELECT u.id, u.name, u.role, u.avatar_color, u.title FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY u.name`,
      [id],
    );

  async function load(id) {
    const p = await db.get(`${SELECT} WHERE p.id = ?`, [localDate(), id]);
    if (!p) throw notFound('Project not found');
    return p;
  }

  async function loadVisible(req) {
    const p = await load(idParam(req.params.id));
    if (!(await access.canViewProject(req.user, p))) throw notFound('Project not found');
    return p;
  }

  const decorate = async (req, p) => ({ ...p, members: await members(p.id), can_manage: access.canManageProject(req.user, p) });

  async function setMembers(tx, projectId, ids, ownerId) {
    const unique = [...new Set([ownerId, ...ids.map(Number)])];
    for (const id of unique) {
      if (!Number.isInteger(id) || !(await tx.get('SELECT 1 FROM users WHERE id = ? AND active = 1', [idParam(id)]))) {
        throw badRequest(`User ${id} not found`);
      }
    }
    await tx.run('DELETE FROM project_members WHERE project_id = ?', [projectId]);
    await tx.run('INSERT INTO project_members (project_id, user_id) SELECT ?, unnest(?::int[])', [projectId, unique]);
  }

  r.get('/', async (req, res) => {
    const scope = await access.projectScope(req.user);
    const where = [scope.sql];
    const params = [localDate(), ...scope.params];
    if (req.query.status) {
      where.push('p.status = ?');
      params.push(String(req.query.status));
    } else if (req.query.include_archived !== '1') {
      where.push("p.status != 'archived'");
    }
    if (req.query.department) {
      where.push('p.department = ?');
      params.push(String(req.query.department));
    }
    const rows = await db.all(
      `${SELECT} WHERE ${where.join(' AND ')} ORDER BY p.status = 'completed', p.due_date IS NULL, p.due_date, p.name`,
      params,
    );
    res.json(await Promise.all(rows.map((p) => decorate(req, p))));
  });

  r.get('/:id', async (req, res) => {
    const p = await loadVisible(req);
    const activity = await db.all(
      `SELECT a.*, u.name AS user_name, t.title AS task_title FROM activity a LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN tasks t ON t.id = a.task_id WHERE a.project_id = ? ORDER BY a.id DESC LIMIT 30`,
      [p.id],
    );
    res.json({ ...(await decorate(req, p)), activity });
  });

  r.post('/', async (req, res) => {
    if (!isManagerRole(req.user.role)) throw forbidden('Only managers can create projects');
    const b = req.body || {};
    const name = requiredString(b.name, 'name', 200);
    const department = b.department ? oneOf(b.department, Object.keys(DEPARTMENTS), 'department') : departmentOf(req.user.role);
    const status = b.status ? oneOf(b.status, keys(PROJECT_STATUSES), 'status') : 'active';
    const ownerId = optionalId(b.owner_id, 'owner_id') ?? req.user.id;
    if (ownerId !== req.user.id && !access.managesUser(req.user, ownerId)) throw forbidden('You can only make yourself or your reports the owner');
    const color = b.color ? String(b.color) : PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];
    const startDate = optionalDate(b.start_date, 'start_date') ?? null;
    const dueDate = optionalDate(b.due_date, 'due_date') ?? null;
    const id = await db.tx(async (tx) => {
      const { id: pid } = await tx.get(
        'INSERT INTO projects (name, description, department, owner_id, status, start_date, due_date, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
        [name, String(b.description || ''), department, ownerId, status, startDate, dueDate, color],
      );
      await setMembers(tx, pid, Array.isArray(b.member_ids) ? b.member_ids : [], ownerId);
      await tx.run('INSERT INTO activity (project_id, user_id, action, detail) VALUES (?, ?, ?, ?)', [pid, req.user.id, 'project_created', name]);
      return pid;
    });
    res.status(201).json(await decorate(req, await load(id)));
  });

  r.patch('/:id', async (req, res) => {
    const p = await loadVisible(req);
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
    await db.tx(async (tx) => {
      const k = Object.keys(f);
      if (k.length) await tx.run(`UPDATE projects SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`, [...k.map((x) => f[x]), p.id]);
      if (Array.isArray(b.member_ids)) await setMembers(tx, p.id, b.member_ids, f.owner_id ?? p.owner_id);
      else if (f.owner_id) {
        await tx.run('INSERT INTO project_members (project_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [p.id, f.owner_id]);
      }
      if (f.status && f.status !== p.status) {
        await tx.run('INSERT INTO activity (project_id, user_id, action, detail) VALUES (?, ?, ?, ?)', [p.id, req.user.id, 'project_status', f.status]);
      }
    });
    res.json(await decorate(req, await load(p.id)));
  });

  r.delete('/:id', async (req, res) => {
    const p = await loadVisible(req);
    if (!access.canManageProject(req.user, p)) throw forbidden();
    // Tasks survive (project_id is set to NULL) so no work history is lost.
    await db.run('DELETE FROM projects WHERE id = ?', [p.id]);
    res.status(204).end();
  });

  return r;
}
