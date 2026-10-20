import { Router } from 'express';
import { hashPassword, publicUser } from '../auth.js';
import { badRequest, forbidden, notFound, oneOf, optionalId, requiredString } from '../http.js';
import { ROLES, departmentOf } from '../meta.js';

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];

export default function userRoutes({ db, access }) {
  const r = Router();
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');

  const withDept = (u) => ({ ...publicUser(u), department: departmentOf(u.role) });

  // Directory: everyone can see the org chart.
  r.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM users ORDER BY name').all();
    const includeInactive = req.query.all === '1' && access.canAdminUsers(req.user);
    res.json(rows.filter((u) => includeInactive || u.active).map(withDept));
  });

  r.get('/assignable', (req, res) => {
    const projectId = optionalId(req.query.project_id, 'project_id') ?? null;
    const ids = access.assignableIds(req.user, projectId);
    const rows = db.prepare('SELECT * FROM users WHERE active = 1 ORDER BY name').all();
    res.json(rows.filter((u) => ids.has(u.id)).map(withDept));
  });

  r.get('/:id', (req, res) => {
    const u = byId.get(Number(req.params.id));
    if (!u) throw notFound('User not found');
    res.json({ ...withDept(u), reports: [...access.reportsOf(u.id)], manages: access.managesUser(req.user, u.id) });
  });

  function validateManager(managerId, userId = null) {
    if (managerId == null) return null;
    const m = byId.get(managerId);
    if (!m || !m.active) throw badRequest('Manager not found');
    if (userId != null && access.wouldCycle(userId, managerId)) throw badRequest('That manager would create a reporting loop');
    return managerId;
  }

  r.post('/', (req, res) => {
    if (!access.canAdminUsers(req.user)) throw forbidden('Only the Head of Company or Operations Manager can add users');
    const b = req.body || {};
    const name = requiredString(b.name, 'name', 120);
    const email = requiredString(b.email, 'email', 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('email is invalid');
    const role = oneOf(b.role, Object.keys(ROLES), 'role');
    if (role === 'ceo' && req.user.role !== 'ceo') throw forbidden('Only the Head of Company can create another Head of Company');
    if (typeof b.password !== 'string' || b.password.length < 8) throw badRequest('password must be at least 8 characters');
    const managerId = validateManager(optionalId(b.manager_id, 'manager_id') ?? null);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw badRequest('A user with that email already exists');
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    const info = db
      .prepare('INSERT INTO users (name, email, password_hash, role, title, manager_id, avatar_color) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(name, email, hashPassword(b.password), role, b.title?.trim() || ROLES[role].label, managerId, color);
    res.status(201).json(withDept(byId.get(Number(info.lastInsertRowid))));
  });

  r.patch('/:id', (req, res) => {
    const target = byId.get(Number(req.params.id));
    if (!target) throw notFound('User not found');
    const isSelf = target.id === req.user.id;
    const admin = access.canAdminUsers(req.user);
    if (!admin && !isSelf) throw forbidden();
    if (target.role === 'ceo' && req.user.role !== 'ceo') throw forbidden('Only the Head of Company can edit that account');
    const b = req.body || {};
    const fields = {};
    if (b.name !== undefined) fields.name = requiredString(b.name, 'name', 120);
    if (b.title !== undefined) fields.title = String(b.title || '').trim();
    if (b.language !== undefined) fields.language = oneOf(b.language, ['en', 'ar'], 'language');
    if (admin) {
      if (b.email !== undefined) {
        const email = requiredString(b.email, 'email', 200).toLowerCase();
        const clash = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, target.id);
        if (clash) throw badRequest('A user with that email already exists');
        fields.email = email;
      }
      if (b.role !== undefined) {
        fields.role = oneOf(b.role, Object.keys(ROLES), 'role');
        if (fields.role === 'ceo' && req.user.role !== 'ceo') throw forbidden('Only the Head of Company can grant that role');
        if (isSelf && fields.role !== target.role) throw badRequest('You cannot change your own role');
      }
      if (b.manager_id !== undefined) fields.manager_id = validateManager(optionalId(b.manager_id, 'manager_id'), target.id);
      if (b.active !== undefined) {
        if (isSelf && !b.active) throw badRequest('You cannot deactivate yourself');
        fields.active = b.active ? 1 : 0;
      }
      if (b.password !== undefined) {
        if (typeof b.password !== 'string' || b.password.length < 8) throw badRequest('password must be at least 8 characters');
        fields.password_hash = hashPassword(b.password);
      }
    }
    const keys = Object.keys(fields);
    if (keys.length) {
      db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), target.id);
    }
    res.json(withDept(byId.get(target.id)));
  });

  return r;
}
