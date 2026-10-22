import { Router } from 'express';
import crypto from 'node:crypto';
import { createResetToken, setPassword } from '../passwords.js';
import { hashPassword, publicUser } from '../auth.js';
import { badRequest, forbidden, idParam, notFound, oneOf, optionalId, requiredString } from '../http.js';
import { ROLES, departmentOf } from '../meta.js';

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];
const INSERT_USER =
  'INSERT INTO users (name, email, password_hash, role, title, manager_id, avatar_color) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id';

export default function userRoutes({ db, access }) {
  const RESET_LINK_HOURS = 72;
  const r = Router();
  const byId = (id, q = db) => q.get('SELECT * FROM users WHERE id = ?', [id]);

  const withDept = (u) => ({ ...publicUser(u), department: departmentOf(u.role) });

  // Directory: everyone can see the org chart.
  r.get('/', async (req, res) => {
    const rows = await db.all('SELECT * FROM users ORDER BY name');
    const includeInactive = req.query.all === '1' && access.canAdminUsers(req.user);
    res.json(rows.filter((u) => includeInactive || u.active).map(withDept));
  });

  r.get('/assignable', async (req, res) => {
    const projectId = optionalId(req.query.project_id, 'project_id') ?? null;
    const ids = await access.assignableIds(req.user, projectId);
    const rows = await db.all('SELECT * FROM users WHERE active = 1 ORDER BY name');
    res.json(rows.filter((u) => ids.has(u.id)).map(withDept));
  });

  r.get('/:id', async (req, res) => {
    const u = await byId(idParam(req.params.id));
    if (!u) throw notFound('User not found');
    res.json({ ...withDept(u), reports: [...access.reportsOf(u.id)], manages: access.managesUser(req.user, u.id) });
  });

  async function validateManager(managerId, userId = null) {
    if (managerId == null) return null;
    const m = await byId(managerId);
    if (!m || !m.active) throw badRequest('Manager not found');
    if (userId != null && access.wouldCycle(userId, managerId)) throw badRequest('That manager would create a reporting loop');
    return managerId;
  }

  r.post('/', async (req, res) => {
    if (!access.canAdminUsers(req.user)) throw forbidden('Only the Head of Company or Operations Manager can add users');
    const b = req.body || {};
    const name = requiredString(b.name, 'name', 120);
    const email = requiredString(b.email, 'email', 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('email is invalid');
    const role = oneOf(b.role, Object.keys(ROLES), 'role');
    if (role === 'ceo' && req.user.role !== 'ceo') throw forbidden('Only the Head of Company can create another Head of Company');
    if (typeof b.password !== 'string' || b.password.length < 8) throw badRequest('password must be at least 8 characters');
    const managerId = await validateManager(optionalId(b.manager_id, 'manager_id') ?? null);
    if (await db.get('SELECT 1 FROM users WHERE email = ?', [email])) throw badRequest('A user with that email already exists');
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    const user = await db.tx(async (tx) => {
      const { id } = await tx.get(INSERT_USER, [name, email, hashPassword(b.password), role, b.title?.trim() || ROLES[role].label, managerId, color]);
      await access.invalidate(tx);
      return byId(id, tx);
    });
    res.status(201).json(withDept(user));
  });

  // Bulk import from a spreadsheet. Each row: { name, email, role?, manager_email?, title?, password? }.
  // Rows are processed in order, so a manager can be created earlier in the same sheet.
  // Passwords not supplied are generated and returned once so they can be handed out.
  r.post('/import', async (req, res) => {
    if (!access.canAdminUsers(req.user)) throw forbidden('Only the Head of Company or Operations Manager can add users');
    const b = req.body || {};
    if (!Array.isArray(b.rows) || !b.rows.length) throw badRequest('The sheet has no rows to import');
    if (b.rows.length > 1000) throw badRequest('Import at most 1000 people at a time');
    const defaultRole = b.default_role ? oneOf(b.default_role, Object.keys(ROLES), 'default_role') : null;
    const defaultManager = await validateManager(optionalId(b.default_manager_id, 'default_manager_id') ?? null);

    const results = await db.tx(async (tx) => {
      const byEmail = (email) => tx.get('SELECT id, active FROM users WHERE email = ?', [email]);
      const out = [];
      for (const [i, row] of b.rows.entries()) {
        const email = String(row?.email ?? '').trim().toLowerCase();
        const base = { row: i + 1, name: String(row?.name ?? '').trim(), email };
        try {
          if (!base.name) throw badRequest('Name is missing');
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Email is missing or invalid');
          if (await byEmail(email)) {
            out.push({ ...base, status: 'skipped', message: 'A user with that email already exists' });
            continue;
          }
          const role = row.role ? oneOf(row.role, Object.keys(ROLES), 'role') : defaultRole;
          if (!role) throw badRequest('Role is missing');
          if (role === 'ceo' && req.user.role !== 'ceo') throw forbidden('Only the Head of Company can create another Head of Company');
          let managerId = defaultManager;
          if (row.manager_email) {
            const m = await byEmail(String(row.manager_email).trim().toLowerCase());
            if (!m || !m.active) throw badRequest('Manager email not found');
            managerId = m.id;
          }
          const supplied = typeof row.password === 'string' && row.password.length >= 8;
          const password = supplied ? row.password : crypto.randomBytes(9).toString('base64url').slice(0, 12);
          const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
          const title = String(row.title ?? '').trim().slice(0, 120) || null;
          await tx.run(INSERT_USER, [base.name.slice(0, 120), email, hashPassword(password), role, title, managerId, color]);
          out.push({ ...base, status: 'created', role, password: supplied ? undefined : password });
        } catch (err) {
          if (!err.status) throw err;
          out.push({ ...base, status: 'error', message: err.message });
        }
      }
      await access.invalidate(tx);
      return out;
    });
    res.json({
      created: results.filter((x) => x.status === 'created').length,
      skipped: results.filter((x) => x.status === 'skipped').length,
      errors: results.filter((x) => x.status === 'error').length,
      results,
    });
  });

  // A one-time link an admin can send by WhatsApp/SMS when email isn't set up.
  // The client builds the URL from its own origin; only the token comes from here.
  r.post('/:id/reset-link', async (req, res) => {
    if (!access.canAdminUsers(req.user)) throw forbidden();
    const target = await byId(idParam(req.params.id));
    if (!target || !target.active) throw notFound('User not found');
    if (target.role === 'ceo' && req.user.role !== 'ceo') throw forbidden('Only the Head of Company can edit that account');
    const token = await createResetToken(db, target.id, RESET_LINK_HOURS, req.user.id);
    res.json({ token, hours: RESET_LINK_HOURS });
  });

  r.patch('/:id', async (req, res) => {
    const target = await byId(idParam(req.params.id));
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
    if (b.email_notifications !== undefined) fields.email_notifications = b.email_notifications ? 1 : 0;
    if (admin) {
      if (b.email !== undefined) {
        const email = requiredString(b.email, 'email', 200).toLowerCase();
        const clash = await db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, target.id]);
        if (clash) throw badRequest('A user with that email already exists');
        fields.email = email;
      }
      if (b.role !== undefined) {
        fields.role = oneOf(b.role, Object.keys(ROLES), 'role');
        if (fields.role === 'ceo' && req.user.role !== 'ceo') throw forbidden('Only the Head of Company can grant that role');
        if (isSelf && fields.role !== target.role) throw badRequest('You cannot change your own role');
      }
      if (b.manager_id !== undefined) fields.manager_id = await validateManager(optionalId(b.manager_id, 'manager_id'), target.id);
      if (b.active !== undefined) {
        if (isSelf && !b.active) throw badRequest('You cannot deactivate yourself');
        fields.active = b.active ? 1 : 0;
      }
      if (b.password !== undefined && (typeof b.password !== 'string' || b.password.length < 8)) {
        throw badRequest('password must be at least 8 characters');
      }
    }
    const keys = Object.keys(fields);
    const user = await db.tx(async (tx) => {
      if (keys.length) {
        await tx.run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => fields[k]), target.id]);
      }
      // Same path as a reset: signs them out everywhere and cancels outstanding reset links.
      if (admin && b.password !== undefined) await setPassword(tx, target.id, b.password);
      await access.invalidate(tx);
      return byId(target.id, tx);
    });
    res.json(withDept(user));
  });

  return r;
}
