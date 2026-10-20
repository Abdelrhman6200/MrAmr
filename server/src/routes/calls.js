// Customer Service call lists: upload a sheet of contacts, split the calls
// between agents, and log the outcome of every call.
//
// - Anyone in Customer Service (and the Head of Company) can open Calls,
//   upload lists, and claim unassigned calls for themselves.
// - The Head of Customer Service / Head of Company assign and reassign calls
//   to any agent; uploaders can manage the lists they uploaded.
// - Agents log outcomes on their own calls; managers on any call.
import { Router } from 'express';
import { transaction } from '../db.js';
import { badRequest, forbidden, notFound, oneOf, optionalId, requiredString } from '../http.js';
import { CALL_STATUSES, departmentOf, isManagerRole, keys } from '../meta.js';

const MAX_ROWS = 5000;
const OPEN = CALL_STATUSES.filter((s) => s.open).map((s) => s.key);
const CLOSED = CALL_STATUSES.filter((s) => !s.open).map((s) => s.key);
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/;

const inCs = (user) => departmentOf(user.role) === 'customer_service';
export const canUseCalls = (user) => user.role === 'ceo' || inCs(user);
const isCallManager = (user) => user.role === 'ceo' || (inCs(user) && isManagerRole(user.role));

const cell = (v, max = 300) => String(v ?? '').trim().slice(0, max);

export default function callRoutes({ db }) {
  const r = Router();
  const notifyStmt = db.prepare('INSERT INTO notifications (user_id, type, message, link, params) VALUES (?, ?, ?, ?, ?)');
  const listById = db.prepare('SELECT * FROM call_lists WHERE id = ?');
  const callById = db.prepare('SELECT * FROM calls WHERE id = ?');

  r.use((req, _res, next) => next(canUseCalls(req.user) ? undefined : forbidden('Calls are available to the Customer Service team')));

  const agents = () =>
    db
      .prepare('SELECT id, name, role, avatar_color, title FROM users WHERE active = 1 ORDER BY name')
      .all()
      .filter((u) => departmentOf(u.role) === 'customer_service');

  const canManageList = (user, list) => isCallManager(user) || list.created_by === user.id;

  function loadList(id) {
    const list = listById.get(Number(id));
    if (!list) throw notFound('Call list not found');
    return list;
  }

  const CALL_SELECT = `
    SELECT c.*, u.name AS assignee_name, u.avatar_color AS assignee_color, l.name AS list_name
    FROM calls c LEFT JOIN users u ON u.id = c.assignee_id JOIN call_lists l ON l.id = c.list_id`;

  const parseCall = (c) => ({ ...c, data: safeJson(c.data, {}) });

  // Round-robin, starting with whoever currently has the fewest open calls.
  function distribute(callIds, agentIds, actor, list) {
    const valid = new Set(agents().map((a) => a.id));
    const ids = [...new Set(agentIds.map(Number))].filter((id) => valid.has(id));
    if (!ids.length) throw badRequest('Pick at least one Customer Service agent');
    if (!isCallManager(actor) && (ids.length > 1 || ids[0] !== actor.id)) {
      throw forbidden('Only the Head of Customer Service can assign calls to other agents');
    }
    const load = new Map(ids.map((id) => [id, 0]));
    const placeholders = ids.map(() => '?').join(',');
    for (const row of db
      .prepare(`SELECT assignee_id, COUNT(*) AS n FROM calls WHERE assignee_id IN (${placeholders}) AND status IN (${OPEN.map(() => '?').join(',')}) GROUP BY assignee_id`)
      .all(...ids, ...OPEN)) {
      load.set(row.assignee_id, row.n);
    }
    const order = [...ids].sort((a, b) => load.get(a) - load.get(b));
    const upd = db.prepare("UPDATE calls SET assignee_id = ?, updated_at = datetime('now') WHERE id = ?");
    const counts = new Map();
    callIds.forEach((cid, i) => {
      const agent = order[i % order.length];
      upd.run(agent, cid);
      counts.set(agent, (counts.get(agent) || 0) + 1);
    });
    for (const [agent, n] of counts) {
      if (agent !== actor.id) {
        notifyStmt.run(agent, 'calls_assigned', `${actor.name} assigned you ${n} call${n > 1 ? 's' : ''} from "${list.name}"`, `/calls?list=${list.id}`, JSON.stringify({ actor: actor.name, count: n, list: list.name }));
      }
    }
    return Object.fromEntries(counts);
  }

  // ---- lists ---------------------------------------------------------------
  r.get('/agents', (_req, res) => res.json(agents()));

  r.get('/lists', (req, res) => {
    const lists = db
      .prepare(
        `SELECT l.*, u.name AS created_by_name,
          COUNT(c.id) AS total,
          SUM(CASE WHEN c.status IN (${CLOSED.map(() => '?').join(',')}) THEN 1 ELSE 0 END) AS done,
          SUM(CASE WHEN c.status = 'reached' THEN 1 ELSE 0 END) AS reached,
          SUM(CASE WHEN c.assignee_id IS NULL THEN 1 ELSE 0 END) AS unassigned,
          SUM(CASE WHEN c.assignee_id = ? THEN 1 ELSE 0 END) AS mine
         FROM call_lists l JOIN users u ON u.id = l.created_by LEFT JOIN calls c ON c.list_id = l.id
         GROUP BY l.id ORDER BY l.id DESC`,
      )
      .all(...CLOSED, req.user.id);
    res.json({ lists: lists.map((l) => ({ ...l, columns: safeJson(l.columns, []), can_manage: canManageList(req.user, l) })), can_assign: isCallManager(req.user) });
  });

  r.post('/lists', (req, res) => {
    const b = req.body || {};
    const name = requiredString(b.name, 'name', 200);
    if (!Array.isArray(b.rows) || !b.rows.length) throw badRequest('The sheet has no rows to import');
    if (b.rows.length > MAX_ROWS) throw badRequest(`A sheet can have at most ${MAX_ROWS} rows`);
    const columns = Array.isArray(b.columns) ? b.columns.map((c) => cell(c, 100)).slice(0, 50) : [];
    const rows = b.rows
      .map((row) => ({
        name: cell(row.name, 200),
        phone: cell(row.phone, 50),
        email: cell(row.email, 200),
        data: row.data && typeof row.data === 'object' ? Object.fromEntries(Object.entries(row.data).slice(0, 50).map(([k, v]) => [cell(k, 100), cell(v, 1000)])) : {},
      }))
      .filter((row) => row.name || row.phone);
    if (!rows.length) throw badRequest('No rows have a name or phone number');

    const result = transaction(db, () => {
      const info = db
        .prepare('INSERT INTO call_lists (name, description, source_filename, columns, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(name, cell(b.description, 1000), cell(b.filename, 200) || null, JSON.stringify(columns), req.user.id);
      const listId = Number(info.lastInsertRowid);
      const ins = db.prepare('INSERT INTO calls (list_id, name, phone, email, data) VALUES (?, ?, ?, ?, ?)');
      const callIds = rows.map((row) => Number(ins.run(listId, row.name || row.phone, row.phone, row.email, JSON.stringify(row.data)).lastInsertRowid));
      let assigned = {};
      if (Array.isArray(b.agent_ids) && b.agent_ids.length) assigned = distribute(callIds, b.agent_ids, req.user, listById.get(listId));
      return { id: listId, imported: callIds.length, skipped: b.rows.length - callIds.length, assigned };
    });
    res.status(201).json(result);
  });

  r.get('/lists/:id', (req, res) => {
    const list = loadList(req.params.id);
    const q = req.query;
    const where = ['c.list_id = ?'];
    const params = [list.id];
    if (q.status === 'open') where.push(`c.status IN (${OPEN.map(() => '?').join(',')})`), params.push(...OPEN);
    else if (q.status) where.push('c.status = ?'), params.push(q.status);
    if (q.assignee_id === 'none') where.push('c.assignee_id IS NULL');
    else if (q.assignee_id) where.push('c.assignee_id = ?'), params.push(q.assignee_id === 'me' ? req.user.id : Number(q.assignee_id));
    if (q.q) where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.data LIKE ?)'), params.push(...Array(4).fill(`%${q.q}%`));
    const calls = db.prepare(`${CALL_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.id`).all(...params);

    const byStatus = Object.fromEntries(
      db.prepare('SELECT status, COUNT(*) AS n FROM calls WHERE list_id = ? GROUP BY status').all(list.id).map((s) => [s.status, s.n]),
    );
    const byAgent = db
      .prepare(
        `SELECT u.id, u.name, u.avatar_color, COUNT(c.id) AS total,
          SUM(CASE WHEN c.status IN (${CLOSED.map(() => '?').join(',')}) THEN 1 ELSE 0 END) AS done,
          SUM(CASE WHEN c.status = 'reached' THEN 1 ELSE 0 END) AS reached,
          SUM(CASE WHEN c.status = 'callback' THEN 1 ELSE 0 END) AS callback
         FROM calls c JOIN users u ON u.id = c.assignee_id WHERE c.list_id = ? GROUP BY u.id ORDER BY u.name`,
      )
      .all(...CLOSED, list.id);
    const creator = db.prepare('SELECT name FROM users WHERE id = ?').get(list.created_by);
    res.json({
      ...list,
      columns: safeJson(list.columns, []),
      created_by_name: creator?.name,
      can_manage: canManageList(req.user, list),
      can_assign: isCallManager(req.user),
      byStatus,
      byAgent,
      calls: calls.map(parseCall),
    });
  });

  r.patch('/lists/:id', (req, res) => {
    const list = loadList(req.params.id);
    if (!canManageList(req.user, list)) throw forbidden();
    const name = req.body?.name !== undefined ? requiredString(req.body.name, 'name', 200) : list.name;
    const description = req.body?.description !== undefined ? cell(req.body.description, 1000) : list.description;
    db.prepare('UPDATE call_lists SET name = ?, description = ? WHERE id = ?').run(name, description, list.id);
    res.json({ ...listById.get(list.id), columns: safeJson(list.columns, []) });
  });

  r.delete('/lists/:id', (req, res) => {
    const list = loadList(req.params.id);
    if (!canManageList(req.user, list)) throw forbidden('Only the Head of Customer Service or the uploader can delete this list');
    db.prepare('DELETE FROM call_lists WHERE id = ?').run(list.id);
    res.status(204).end();
  });

  // Assign calls. Body: { agent_ids: [...], call_ids?: [...], only_unassigned?: bool }.
  // Several agents → split evenly; one agent → all to them; agent_ids [] → unassign.
  r.post('/lists/:id/assign', (req, res) => {
    const list = loadList(req.params.id);
    const b = req.body || {};
    const agentIds = Array.isArray(b.agent_ids) ? b.agent_ids : [];
    let callIds;
    if (Array.isArray(b.call_ids) && b.call_ids.length) {
      const ph = b.call_ids.map(() => '?').join(',');
      callIds = db.prepare(`SELECT id FROM calls WHERE list_id = ? AND id IN (${ph}) ORDER BY id`).all(list.id, ...b.call_ids.map(Number)).map((c) => c.id);
    } else {
      const onlyUnassigned = b.only_unassigned !== false;
      callIds = db
        .prepare(`SELECT id FROM calls WHERE list_id = ? AND status IN (${OPEN.map(() => '?').join(',')}) ${onlyUnassigned ? 'AND assignee_id IS NULL' : ''} ORDER BY id`)
        .all(list.id, ...OPEN)
        .map((c) => c.id);
    }
    if (!callIds.length) throw badRequest('There are no calls to assign');

    if (!isCallManager(req.user)) {
      // Agents may only claim unassigned calls for themselves.
      const ph = callIds.map(() => '?').join(',');
      const taken = db.prepare(`SELECT COUNT(*) AS n FROM calls WHERE id IN (${ph}) AND assignee_id IS NOT NULL AND assignee_id != ?`).get(...callIds, req.user.id).n;
      if (taken) throw forbidden('You can only claim calls that are not assigned to someone else');
    }

    const result = transaction(db, () => {
      if (!agentIds.length) {
        if (!isCallManager(req.user)) throw forbidden('Only the Head of Customer Service can unassign calls');
        const ph = callIds.map(() => '?').join(',');
        db.prepare(`UPDATE calls SET assignee_id = NULL, updated_at = datetime('now') WHERE id IN (${ph})`).run(...callIds);
        return {};
      }
      return distribute(callIds, agentIds, req.user, list);
    });
    res.json({ updated: callIds.length, assigned: result });
  });

  // ---- individual calls ------------------------------------------------------
  r.get('/mine', (req, res) => {
    const status = req.query.status === 'done' ? CLOSED : OPEN;
    const calls = db
      .prepare(
        `${CALL_SELECT} WHERE c.assignee_id = ? AND c.status IN (${status.map(() => '?').join(',')})
         ORDER BY CASE WHEN c.status = 'callback' AND c.callback_at <= datetime('now','localtime') THEN 0 WHEN c.status = 'pending' THEN 1 ELSE 2 END,
                  c.callback_at IS NULL, c.callback_at, c.id LIMIT 500`,
      )
      .all(req.user.id, ...status);
    const counts = Object.fromEntries(
      db.prepare('SELECT status, COUNT(*) AS n FROM calls WHERE assignee_id = ? GROUP BY status').all(req.user.id).map((s) => [s.status, s.n]),
    );
    const today = db
      .prepare("SELECT COUNT(*) AS n FROM call_logs WHERE user_id = ? AND created_at >= datetime('now','start of day')")
      .get(req.user.id).n;
    res.json({ calls: calls.map(parseCall), counts, loggedToday: today });
  });

  r.get('/:id', (req, res) => {
    const c = db.prepare(`${CALL_SELECT} WHERE c.id = ?`).get(Number(req.params.id));
    if (!c) throw notFound('Call not found');
    const logs = db
      .prepare('SELECT g.*, u.name AS user_name FROM call_logs g LEFT JOIN users u ON u.id = g.user_id WHERE g.call_id = ? ORDER BY g.id DESC')
      .all(c.id);
    res.json({ ...parseCall(c), logs, can_log: c.assignee_id === req.user.id || isCallManager(req.user) });
  });

  // Log an outcome: { status, note?, callback_at? }. Also accepts assignee_id for managers.
  r.patch('/:id', (req, res) => {
    const c = callById.get(Number(req.params.id));
    if (!c) throw notFound('Call not found');
    const b = req.body || {};
    const manager = isCallManager(req.user);

    if (b.assignee_id !== undefined) {
      const to = optionalId(b.assignee_id, 'assignee_id');
      const claiming = to === req.user.id && c.assignee_id == null;
      if (!manager && !claiming) throw forbidden('Only the Head of Customer Service can reassign calls');
      if (to != null && !agents().some((a) => a.id === to)) throw badRequest('Assignee must be a Customer Service agent');
      db.prepare("UPDATE calls SET assignee_id = ?, updated_at = datetime('now') WHERE id = ?").run(to, c.id);
      if (to && to !== req.user.id) {
        const list = listById.get(c.list_id);
        notifyStmt.run(to, 'calls_assigned', `${req.user.name} assigned you a call with ${c.name}`, `/calls?list=${list.id}&call=${c.id}`, JSON.stringify({ actor: req.user.name, count: 1, contact: c.name, list: list.name }));
      }
    }

    if (b.status !== undefined || b.note !== undefined) {
      const owner = (b.assignee_id !== undefined ? optionalId(b.assignee_id, 'assignee_id') : c.assignee_id) === req.user.id;
      if (!owner && !manager) throw forbidden('Only the assigned agent can log this call');
      const status = b.status !== undefined ? oneOf(b.status, keys(CALL_STATUSES), 'status') : c.status;
      const note = cell(b.note, 2000);
      let callbackAt = null;
      if (status === 'callback') {
        if (!b.callback_at || !DATETIME_RE.test(b.callback_at)) throw badRequest('Choose when to call back');
        callbackAt = b.callback_at.replace(' ', 'T').slice(0, 16);
      }
      const isAttempt = status !== 'pending';
      transaction(db, () => {
        db.prepare(
          `UPDATE calls SET status = ?, callback_at = ?, notes = CASE WHEN ? != '' THEN ? ELSE notes END,
             attempts = attempts + ?, last_called_at = CASE WHEN ? THEN datetime('now') ELSE last_called_at END, updated_at = datetime('now')
           WHERE id = ?`,
        ).run(status, callbackAt, note, note, isAttempt ? 1 : 0, isAttempt ? 1 : 0, c.id);
        db.prepare('INSERT INTO call_logs (call_id, user_id, status, note) VALUES (?, ?, ?, ?)').run(c.id, req.user.id, status, note);
      });
    }
    const updated = db.prepare(`${CALL_SELECT} WHERE c.id = ?`).get(c.id);
    res.json(parseCall(updated));
  });

  return r;
}

function safeJson(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}
