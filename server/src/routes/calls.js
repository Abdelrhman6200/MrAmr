// Customer Service call lists: upload a sheet of contacts, split the calls
// between agents, and log the outcome of every call.
//
// - Anyone in Customer Service (and the Head of Company) can open Calls,
//   upload lists, and claim unassigned calls for themselves.
// - The Head of Customer Service / Head of Company assign and reassign calls
//   to any agent; uploaders can manage the lists they uploaded.
// - Agents log outcomes on their own calls; managers on any call.
import { Router } from 'express';
import { badRequest, forbidden, idParam, notFound, oneOf, optionalId, requiredString } from '../http.js';
import { CALL_STATUSES, departmentOf, isManagerRole, keys } from '../meta.js';
import { localNowMinute, localTodayStartUtc, nowUtc, utcAgo, DAY } from '../time.js';
import { likeEscape } from './tasks.js';

const MAX_ROWS = 5000;
// Rows per request. The client sends big sheets in several requests so each
// stays well under hosting body limits (Vercel: 4.5 MB).
const MAX_CHUNK = 1000;
const OPEN = CALL_STATUSES.filter((s) => s.open).map((s) => s.key);
const CLOSED = CALL_STATUSES.filter((s) => !s.open).map((s) => s.key);
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/;

const inCs = (user) => departmentOf(user.role) === 'customer_service';
export const canUseCalls = (user) => user.role === 'ceo' || inCs(user);
const isCsManagerRole = (role) => departmentOf(role) === 'customer_service' && isManagerRole(role);

const cell = (v, max = 300) => String(v ?? '').trim().slice(0, max);

function cleanRows(rows) {
  return rows
    .map((row) => ({
      name: cell(row?.name, 200),
      phone: cell(row?.phone, 50),
      email: cell(row?.email, 200),
      data:
        row?.data && typeof row.data === 'object'
          ? Object.fromEntries(Object.entries(row.data).slice(0, 50).map(([k, v]) => [cell(k, 100), cell(v, 1000)]))
          : {},
    }))
    .filter((row) => row.name || row.phone);
}

export default function callRoutes({ db, access }) {
  const r = Router();
  // Customer Service managers and team leaders, and whoever is acting for one today.
  const isCallManager = (user) =>
    user.role === 'ceo' || (inCs(user) && isManagerRole(user.role)) || [...access.covering(user.id)].some((id) => isCsManagerRole(access.roleOf(id)));
  const notify = (q, userId, message, link, params) =>
    q.run('INSERT INTO notifications (user_id, type, message, link, params) VALUES (?, ?, ?, ?, ?)', [
      userId,
      'calls_assigned',
      message,
      link,
      JSON.stringify(params),
    ]);
  const listById = (id, q = db) => q.get('SELECT * FROM call_lists WHERE id = ?', [id]);

  r.use((req, _res, next) => next(canUseCalls(req.user) ? undefined : forbidden('Calls are available to the Customer Service team')));

  const agents = async (q = db) =>
    (await q.all('SELECT id, name, role, avatar_color, title FROM users WHERE active = 1 ORDER BY name')).filter(
      (u) => departmentOf(u.role) === 'customer_service',
    );

  const canManageList = (user, list) => isCallManager(user) || list.created_by === user.id;

  async function loadList(id) {
    const list = await listById(idParam(id));
    if (!list) throw notFound('Call list not found');
    return list;
  }

  const CALL_SELECT = `
    SELECT c.*, u.name AS assignee_name, u.avatar_color AS assignee_color, l.name AS list_name
    FROM calls c LEFT JOIN users u ON u.id = c.assignee_id JOIN call_lists l ON l.id = c.list_id`;

  const parseCall = (c) => ({ ...c, data: safeJson(c.data, {}) });

  // Inserts rows into a list in one statement; returns the new call ids.
  async function insertRows(q, listId, rows) {
    const created = await q.all(
      `INSERT INTO calls (list_id, name, phone, email, data)
       SELECT ?, * FROM unnest(?::text[], ?::text[], ?::text[], ?::text[]) RETURNING id`,
      [
        listId,
        rows.map((row) => row.name || row.phone),
        rows.map((row) => row.phone),
        rows.map((row) => row.email),
        rows.map((row) => JSON.stringify(row.data)),
      ],
    );
    return created.map((c) => c.id).sort((a, b) => a - b);
  }

  // Round-robin, starting with whoever currently has the fewest open calls.
  // `q` is the transaction to run in.
  async function distribute(q, callIds, agentIds, actor, list) {
    const valid = new Set((await agents(q)).map((a) => a.id));
    const ids = [...new Set(agentIds.map(Number))].filter((id) => valid.has(id));
    if (!ids.length) throw badRequest('Pick at least one Customer Service agent');
    if (!isCallManager(actor) && (ids.length > 1 || ids[0] !== actor.id)) {
      throw forbidden('Only the Head of Customer Service can assign calls to other agents');
    }
    const load = new Map(ids.map((id) => [id, 0]));
    const rows = await q.all(
      'SELECT assignee_id, COUNT(*) AS n FROM calls WHERE assignee_id = ANY(?::int[]) AND status = ANY(?::text[]) GROUP BY assignee_id',
      [ids, OPEN],
    );
    for (const row of rows) load.set(row.assignee_id, row.n);
    const order = [...ids].sort((a, b) => load.get(a) - load.get(b));
    const agentFor = callIds.map((_, i) => order[i % order.length]);
    await q.run(
      `UPDATE calls SET assignee_id = x.agent, updated_at = ?
       FROM unnest(?::int[], ?::int[]) AS x(call_id, agent) WHERE calls.id = x.call_id`,
      [nowUtc(), callIds, agentFor],
    );
    const counts = new Map();
    for (const agent of agentFor) counts.set(agent, (counts.get(agent) || 0) + 1);
    for (const [agent, n] of counts) {
      if (agent !== actor.id) {
        await notify(q, agent, `${actor.name} assigned you ${n} call${n > 1 ? 's' : ''} from "${list.name}"`, `/calls?list=${list.id}`, {
          actor: actor.name,
          count: n,
          list: list.name,
        });
      }
    }
    return Object.fromEntries(counts);
  }

  // ---- lists ---------------------------------------------------------------
  r.get('/agents', async (_req, res) => res.json(await agents()));

  // Per-agent performance across all lists (managers only).
  r.get('/stats', async (req, res) => {
    if (!isCallManager(req.user)) throw forbidden();
    const days = Math.min(Math.max(Math.floor(Number(req.query.days)) || 7, 1), 365);
    const people = await agents();
    const ids = people.map((a) => a.id);
    const [queues, logs] = await Promise.all([
      db.all(
        `SELECT assignee_id AS id, COUNT(*) AS open, COUNT(*) FILTER (WHERE status = 'callback' AND callback_at <= ?) AS due
         FROM calls WHERE assignee_id = ANY(?::int[]) AND status = ANY(?::text[]) GROUP BY assignee_id`,
        [localNowMinute(), ids, OPEN],
      ),
      db.all(
        `SELECT user_id AS id, COUNT(*) AS logged, COUNT(DISTINCT call_id) AS contacts,
           COUNT(*) FILTER (WHERE status = 'reached') AS reached,
           COUNT(*) FILTER (WHERE status = 'no_answer') AS no_answer,
           COUNT(*) FILTER (WHERE created_at >= ?) AS today
         FROM call_logs WHERE user_id = ANY(?::int[]) AND created_at >= ? GROUP BY user_id`,
        [localTodayStartUtc(), ids, utcAgo(days * DAY)],
      ),
    ]);
    const queueOf = new Map(queues.map((x) => [x.id, x]));
    const logOf = new Map(logs.map((x) => [x.id, x]));
    const rows = people.map((a) => {
      const q = queueOf.get(a.id) || {};
      const l = logOf.get(a.id) || {};
      return {
        ...a,
        open: q.open || 0,
        due: q.due || 0,
        logged: l.logged || 0,
        contacts: l.contacts || 0,
        reached: l.reached || 0,
        no_answer: l.no_answer || 0,
        today: l.today || 0,
      };
    });
    res.json({ days, agents: rows });
  });

  r.get('/lists', async (req, res) => {
    const lists = await db.all(
      `SELECT l.*, u.name AS created_by_name,
        COUNT(c.id) AS total,
        COUNT(c.id) FILTER (WHERE c.status = ANY(?::text[])) AS done,
        COUNT(c.id) FILTER (WHERE c.status = 'reached') AS reached,
        COUNT(c.id) FILTER (WHERE c.assignee_id IS NULL) AS unassigned,
        COUNT(c.id) FILTER (WHERE c.assignee_id = ?) AS mine
       FROM call_lists l JOIN users u ON u.id = l.created_by LEFT JOIN calls c ON c.list_id = l.id
       GROUP BY l.id, u.name ORDER BY l.id DESC`,
      [CLOSED, req.user.id],
    );
    res.json({ lists: lists.map((l) => ({ ...l, columns: safeJson(l.columns, []), can_manage: canManageList(req.user, l) })), can_assign: isCallManager(req.user) });
  });

  // Creates a list with its first rows. Bigger sheets add the rest with POST /lists/:id/rows.
  r.post('/lists', async (req, res) => {
    const b = req.body || {};
    const name = requiredString(b.name, 'name', 200);
    if (!Array.isArray(b.rows) || !b.rows.length) throw badRequest('The sheet has no rows to import');
    if (b.rows.length > MAX_ROWS) throw badRequest(`A sheet can have at most ${MAX_ROWS} rows`);
    const columns = Array.isArray(b.columns) ? b.columns.map((c) => cell(c, 100)).slice(0, 50) : [];
    const rows = cleanRows(b.rows);
    if (!rows.length) throw badRequest('No rows have a name or phone number');

    const result = await db.tx(async (tx) => {
      const list = await tx.get(
        'INSERT INTO call_lists (name, description, source_filename, columns, created_by) VALUES (?, ?, ?, ?, ?) RETURNING *',
        [name, cell(b.description, 1000), cell(b.filename, 200) || null, JSON.stringify(columns), req.user.id],
      );
      const callIds = await insertRows(tx, list.id, rows);
      let assigned = {};
      if (Array.isArray(b.agent_ids) && b.agent_ids.length) assigned = await distribute(tx, callIds, b.agent_ids, req.user, list);
      return { id: list.id, imported: callIds.length, skipped: b.rows.length - callIds.length, assigned };
    });
    res.status(201).json(result);
  });

  r.post('/lists/:id/rows', async (req, res) => {
    const list = await loadList(req.params.id);
    if (!canManageList(req.user, list)) throw forbidden();
    const b = req.body || {};
    if (!Array.isArray(b.rows) || !b.rows.length) throw badRequest('The sheet has no rows to import');
    if (b.rows.length > MAX_CHUNK) throw badRequest(`Send at most ${MAX_CHUNK} rows at a time`);
    const rows = cleanRows(b.rows);
    const imported = await db.tx(async (tx) => {
      // Lock the list so parallel uploads can't push it past the limit.
      await tx.run('SELECT id FROM call_lists WHERE id = ? FOR UPDATE', [list.id]);
      const { n } = await tx.get('SELECT COUNT(*) AS n FROM calls WHERE list_id = ?', [list.id]);
      if (n + rows.length > MAX_ROWS) throw badRequest(`A sheet can have at most ${MAX_ROWS} rows`);
      return rows.length ? (await insertRows(tx, list.id, rows)).length : 0;
    });
    res.status(201).json({ imported, skipped: b.rows.length - imported });
  });

  r.get('/lists/:id', async (req, res) => {
    const list = await loadList(req.params.id);
    const q = req.query;
    const where = ['c.list_id = ?'];
    const params = [list.id];
    if (q.status === 'open') where.push('c.status = ANY(?::text[])'), params.push(OPEN);
    else if (q.status) where.push('c.status = ?'), params.push(String(q.status));
    if (q.assignee_id === 'none') where.push('c.assignee_id IS NULL');
    else if (q.assignee_id) where.push('c.assignee_id = ?'), params.push(q.assignee_id === 'me' ? req.user.id : idParam(q.assignee_id));
    if (q.q) {
      where.push('(c.name ILIKE ? OR c.phone ILIKE ? OR c.email ILIKE ? OR c.data ILIKE ?)');
      params.push(...Array(4).fill(`%${likeEscape(q.q)}%`));
    }
    const [calls, statuses, byAgent, creator] = await Promise.all([
      db.all(`${CALL_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.id`, params),
      db.all('SELECT status, COUNT(*) AS n FROM calls WHERE list_id = ? GROUP BY status', [list.id]),
      db.all(
        `SELECT u.id, u.name, u.avatar_color, COUNT(c.id) AS total,
          COUNT(c.id) FILTER (WHERE c.status = ANY(?::text[])) AS done,
          COUNT(c.id) FILTER (WHERE c.status = 'reached') AS reached,
          COUNT(c.id) FILTER (WHERE c.status = 'callback') AS callback
         FROM calls c JOIN users u ON u.id = c.assignee_id WHERE c.list_id = ? GROUP BY u.id ORDER BY u.name`,
        [CLOSED, list.id],
      ),
      db.get('SELECT name FROM users WHERE id = ?', [list.created_by]),
    ]);
    res.json({
      ...list,
      columns: safeJson(list.columns, []),
      created_by_name: creator?.name,
      can_manage: canManageList(req.user, list),
      can_assign: isCallManager(req.user),
      byStatus: Object.fromEntries(statuses.map((s) => [s.status, s.n])),
      byAgent,
      calls: calls.map(parseCall),
    });
  });

  r.patch('/lists/:id', async (req, res) => {
    const list = await loadList(req.params.id);
    if (!canManageList(req.user, list)) throw forbidden();
    const name = req.body?.name !== undefined ? requiredString(req.body.name, 'name', 200) : list.name;
    const description = req.body?.description !== undefined ? cell(req.body.description, 1000) : list.description;
    const updated = await db.get('UPDATE call_lists SET name = ?, description = ? WHERE id = ? RETURNING *', [name, description, list.id]);
    res.json({ ...updated, columns: safeJson(updated.columns, []) });
  });

  r.delete('/lists/:id', async (req, res) => {
    const list = await loadList(req.params.id);
    if (!canManageList(req.user, list)) throw forbidden('Only the Head of Customer Service or the uploader can delete this list');
    await db.run('DELETE FROM call_lists WHERE id = ?', [list.id]);
    res.status(204).end();
  });

  // Assign calls. Body: { agent_ids: [...], call_ids?: [...], only_unassigned?: bool }.
  // Several agents → split evenly; one agent → all to them; agent_ids [] → unassign.
  r.post('/lists/:id/assign', async (req, res) => {
    const list = await loadList(req.params.id);
    const b = req.body || {};
    const agentIds = Array.isArray(b.agent_ids) ? b.agent_ids : [];
    let callIds;
    if (Array.isArray(b.call_ids) && b.call_ids.length) {
      const wanted = b.call_ids.map(idParam);
      callIds = (await db.all('SELECT id FROM calls WHERE list_id = ? AND id = ANY(?::int[]) ORDER BY id', [list.id, wanted])).map((c) => c.id);
    } else {
      const onlyUnassigned = b.only_unassigned !== false;
      callIds = (
        await db.all(
          `SELECT id FROM calls WHERE list_id = ? AND status = ANY(?::text[]) ${onlyUnassigned ? 'AND assignee_id IS NULL' : ''} ORDER BY id`,
          [list.id, OPEN],
        )
      ).map((c) => c.id);
    }
    if (!callIds.length) throw badRequest('There are no calls to assign');

    const result = await db.tx(async (tx) => {
      if (!isCallManager(req.user)) {
        // Agents may only claim unassigned calls for themselves. Checked under a
        // row lock so two agents can't claim the same call at once.
        const taken = await tx.all('SELECT id FROM calls WHERE id = ANY(?::int[]) AND assignee_id IS NOT NULL AND assignee_id != ? FOR UPDATE', [
          callIds,
          req.user.id,
        ]);
        if (taken.length) throw forbidden('You can only claim calls that are not assigned to someone else');
      }
      if (!agentIds.length) {
        if (!isCallManager(req.user)) throw forbidden('Only the Head of Customer Service can unassign calls');
        await tx.run('UPDATE calls SET assignee_id = NULL, updated_at = ? WHERE id = ANY(?::int[])', [nowUtc(), callIds]);
        return {};
      }
      return distribute(tx, callIds, agentIds, req.user, list);
    });
    res.json({ updated: callIds.length, assigned: result });
  });

  // ---- individual calls ------------------------------------------------------
  r.get('/mine', async (req, res) => {
    const status = req.query.status === 'done' ? CLOSED : OPEN;
    const [calls, counts, today] = await Promise.all([
      db.all(
        `${CALL_SELECT} WHERE c.assignee_id = ? AND c.status = ANY(?::text[])
         ORDER BY CASE WHEN c.status = 'callback' AND c.callback_at <= ? THEN 0 WHEN c.status = 'pending' THEN 1 ELSE 2 END,
                  c.callback_at IS NULL, c.callback_at, c.id LIMIT 500`,
        [req.user.id, status, localNowMinute()],
      ),
      db.all('SELECT status, COUNT(*) AS n FROM calls WHERE assignee_id = ? GROUP BY status', [req.user.id]),
      db.get('SELECT COUNT(*) AS n FROM call_logs WHERE user_id = ? AND created_at >= ?', [req.user.id, localTodayStartUtc()]),
    ]);
    res.json({ calls: calls.map(parseCall), counts: Object.fromEntries(counts.map((s) => [s.status, s.n])), loggedToday: today.n });
  });

  r.get('/:id', async (req, res) => {
    const c = await db.get(`${CALL_SELECT} WHERE c.id = ?`, [idParam(req.params.id)]);
    if (!c) throw notFound('Call not found');
    const logs = await db.all(
      'SELECT g.*, u.name AS user_name FROM call_logs g LEFT JOIN users u ON u.id = g.user_id WHERE g.call_id = ? ORDER BY g.id DESC',
      [c.id],
    );
    res.json({ ...parseCall(c), logs, can_log: c.assignee_id === req.user.id || isCallManager(req.user) });
  });

  // Log an outcome: { status, note?, callback_at? }. Also accepts assignee_id for managers.
  r.patch('/:id', async (req, res) => {
    const c = await db.get('SELECT * FROM calls WHERE id = ?', [idParam(req.params.id)]);
    if (!c) throw notFound('Call not found');
    const b = req.body || {};
    const manager = isCallManager(req.user);

    let to;
    if (b.assignee_id !== undefined) {
      to = optionalId(b.assignee_id, 'assignee_id');
      const claiming = to === req.user.id && c.assignee_id == null;
      if (!manager && !claiming) throw forbidden('Only the Head of Customer Service can reassign calls');
      if (to != null && !(await agents()).some((a) => a.id === to)) throw badRequest('Assignee must be a Customer Service agent');
    }

    let outcome = null;
    if (b.status !== undefined || b.note !== undefined) {
      const owner = (b.assignee_id !== undefined ? to : c.assignee_id) === req.user.id;
      if (!owner && !manager) throw forbidden('Only the assigned agent can log this call');
      // A request with only a note annotates the call; it isn't a new attempt and
      // keeps the current outcome and call-back time.
      const loggingOutcome = b.status !== undefined;
      const status = loggingOutcome ? oneOf(b.status, keys(CALL_STATUSES), 'status') : c.status;
      const note = cell(b.note, 2000);
      if (!loggingOutcome && !note) throw badRequest('Write a note');
      let callbackAt = loggingOutcome ? null : c.callback_at;
      if (loggingOutcome && status === 'callback') {
        if (typeof b.callback_at !== 'string' || !DATETIME_RE.test(b.callback_at)) throw badRequest('Choose when to call back');
        callbackAt = b.callback_at.replace(' ', 'T').slice(0, 16);
      }
      outcome = { loggingOutcome, status, note, callbackAt, isAttempt: loggingOutcome && status !== 'pending' };
    }

    await db.tx(async (tx) => {
      const now = nowUtc();
      if (b.assignee_id !== undefined) {
        if (!manager) {
          // Claiming: only succeeds while the call is still unassigned.
          const claimed = await tx.run('UPDATE calls SET assignee_id = ?, updated_at = ? WHERE id = ? AND assignee_id IS NULL', [to, now, c.id]);
          if (!claimed.rowCount) throw forbidden('Someone else has already taken this call');
        } else {
          await tx.run('UPDATE calls SET assignee_id = ?, updated_at = ? WHERE id = ?', [to, now, c.id]);
        }
        if (to && to !== req.user.id) {
          const list = await listById(c.list_id, tx);
          await notify(tx, to, `${req.user.name} assigned you a call with ${c.name}`, `/calls?list=${list.id}&call=${c.id}`, {
            actor: req.user.name,
            count: 1,
            contact: c.name,
            list: list.name,
          });
        }
      }
      if (outcome) {
        const { status, note, callbackAt, isAttempt } = outcome;
        await tx.run(
          `UPDATE calls SET status = ?, callback_at = ?, notes = CASE WHEN ? != '' THEN ? ELSE notes END,
             attempts = attempts + ?, last_called_at = CASE WHEN ? THEN ? ELSE last_called_at END, updated_at = ?
           WHERE id = ?`,
          [status, callbackAt, note, note, isAttempt ? 1 : 0, isAttempt, now, now, c.id],
        );
        await tx.run('INSERT INTO call_logs (call_id, user_id, status, note) VALUES (?, ?, ?, ?)', [c.id, req.user.id, status, note]);
      }
    });
    const updated = await db.get(`${CALL_SELECT} WHERE c.id = ?`, [c.id]);
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
