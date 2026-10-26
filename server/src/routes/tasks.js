import { Router } from 'express';
import { HttpError, badRequest, forbidden, idParam, notFound, oneOf, optionalDate, optionalId, requiredString } from '../http.js';
import { PRIORITIES, ROLES, STATUSES, TASK_TYPES, TRACKS, keys } from '../meta.js';
import { localDate, nowUtc } from '../time.js';
import { translate } from '../../../client/src/i18n.js';
import { stepsFor } from './sops.js';
import { normaliseSop } from '../../../client/src/sops.js';

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

// Text for a LIKE pattern, with its wildcards taken literally.
export const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

function normaliseTags(tags) {
  if (tags === undefined) return undefined;
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20).join(',');
}

// Tracks are tags: any of general / azhar / baccalaureate, stored comma-separated in a fixed order.
function tracks(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  const picked = new Set(list.map((t) => String(t).trim()).filter(Boolean).map((t) => oneOf(t, keys(TRACKS), 'track')));
  return keys(TRACKS).filter((k) => picked.has(k)).join(',');
}

// Checklist entries: "text", "!text" for a required step, or { text, required }.
const checklistItems = (list) =>
  normaliseSop({ steps: list.slice(0, 200).map((s) => (typeof s === 'string' ? s.trim().slice(0, 500) : { text: String(s?.text || '').trim().slice(0, 500), required: !!s?.required })) }).steps;

// A task can't go to review or be done while required SOP steps are unticked.
async function checkRequiredSteps(q, taskId) {
  const left = await q.all('SELECT text FROM checklist_items WHERE task_id = ? AND required = 1 AND done = 0 ORDER BY position, id', [taskId]);
  if (left.length) throw new HttpError(400, 'Tick the required SOP steps first', 'required_steps', { steps: left.map((r) => r.text) });
}

function estimate(value) {
  if (value === '' || value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw badRequest('estimate_hours must be a number of hours');
  return n;
}

export default function taskRoutes({ db, access }) {
  const r = Router();
  const userById = (id, q = db) => q.get('SELECT id, name, active FROM users WHERE id = ?', [id]);
  const projectById = (id, q = db) => q.get('SELECT * FROM projects WHERE id = ?', [id]);

  // These take the transaction they run in.
  const log = (q, task, userId, action, detail = '') =>
    q.run('INSERT INTO activity (task_id, project_id, user_id, action, detail) VALUES (?, ?, ?, ?, ?)', [
      task.id,
      task.project_id ?? null,
      userId,
      action,
      detail,
    ]);
  // `message` is the English fallback; `params` lets the client render it in any language.
  const notify = async (q, actor, userId, type, message, taskId, title) => {
    if (userId == null || userId === actor.id) return;
    await q.run('INSERT INTO notifications (user_id, type, message, task_id, params) VALUES (?, ?, ?, ?, ?)', [
      userId,
      type,
      message,
      taskId,
      JSON.stringify({ actor: actor.name, title }),
    ]);
  };

  const raw = (id, q = db) => q.get('SELECT * FROM tasks WHERE id = ?', [id]);
  const full = (id) => db.get(`${TASK_SELECT} WHERE t.id = ?`, [id]);

  async function loadVisible(req) {
    const t = await raw(idParam(req.params.id));
    if (!t || !(await access.canViewTask(req.user, t))) throw notFound('Task not found');
    return t;
  }

  async function loadEditable(req) {
    const t = await loadVisible(req);
    if (!(await access.canEditTask(req.user, t))) throw forbidden('You cannot edit this task');
    return t;
  }

  const perms = async (user, t) => ({
    can_edit: await access.canEditTask(user, t),
    can_delete: await access.canDeleteTask(user, t),
    can_review: access.canReviewTask(user, t),
    can_change_reviewer: await access.canChangeReviewer(user, t),
  });

  const respond = async (req, res, id, status = 200) => {
    const t = await full(id);
    res.status(status).json({ ...t, ...(await perms(req.user, t)) });
  };

  async function checkAssignee(user, assigneeId, projectId) {
    if (assigneeId == null) return;
    const u = await userById(assigneeId);
    if (!u || !u.active) throw badRequest('Assignee not found');
    if (!(await access.assignableIds(user, projectId)).has(assigneeId)) {
      throw forbidden(`You cannot assign work to ${u.name}. You can assign to yourself, your team, project members, or any manager.`);
    }
  }

  async function checkReviewer(reviewerId) {
    if (reviewerId == null) return;
    const u = await userById(reviewerId);
    if (!u || !u.active) throw badRequest('Reviewer not found');
  }

  async function checkProject(user, projectId) {
    if (projectId == null) return;
    const p = await projectById(projectId);
    if (!p || !(await access.canViewProject(user, p))) throw badRequest('Project not found');
  }

  // ---- list -------------------------------------------------------------
  r.get('/', async (req, res) => {
    const q = req.query;
    const scope = await access.taskScope(req.user);
    const where = [scope.sql];
    const params = [...scope.params];
    const add = (sql, ...p) => {
      where.push(sql);
      params.push(...p);
    };
    const today = localDate();

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
      case 'team':
        add('t.assignee_id = ANY(?::int[])', [...access.reportsOf(req.user.id)]);
        break;
    }
    if (q.status) add('t.status = ANY(?::text[])', String(q.status).split(','));
    if (q.open === '1') add("t.status != 'done'");
    if (q.priority) add('t.priority = ?', String(q.priority));
    if (q.type) add('t.type = ANY(?::text[])', String(q.type).split(','));
    if (q.track) add("(',' || t.track || ',') LIKE ?", `%,${likeEscape(String(q.track))},%`);
    if (q.project_id === 'none') add('t.project_id IS NULL');
    else if (q.project_id) add('t.project_id = ?', idParam(q.project_id));
    if (q.assignee_id === 'none') add('t.assignee_id IS NULL');
    else if (q.assignee_id) add('t.assignee_id = ?', q.assignee_id === 'me' ? req.user.id : idParam(q.assignee_id));
    if (q.department) add('a.role = ANY(?::text[])', rolesInDept(q.department));
    if (q.tag) add("(',' || t.tags || ',') LIKE ?", `%,${likeEscape(String(q.tag).toLowerCase())},%`);
    if (q.q) add('(t.title ILIKE ? OR t.description ILIKE ?)', `%${likeEscape(q.q)}%`, `%${likeEscape(q.q)}%`);
    if (q.due === 'overdue') add("t.status != 'done' AND t.due_date < ?", today);
    if (q.due === 'today') add('t.due_date = ?', today);
    if (q.due === 'week') add("t.status != 'done' AND t.due_date BETWEEN ? AND ?", today, localDate(7));
    if (q.from) add('t.due_date >= ?', String(q.from));
    if (q.to) add('t.due_date <= ?', String(q.to));

    const limit = Math.min(Math.max(Math.floor(Number(q.limit)) || 500, 1), 1000);
    const rows = await db.all(
      `${TASK_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.status = 'done', ${PRIORITY_ORDER}, t.due_date IS NULL, t.due_date, t.id DESC LIMIT ${limit}`,
      params,
    );
    res.json(rows);
  });

  // ---- detail -----------------------------------------------------------
  r.get('/:id', async (req, res) => {
    const t = await loadVisible(req);
    const [checklist, comments, activity, detail, p] = await Promise.all([
      db.all('SELECT * FROM checklist_items WHERE task_id = ? ORDER BY position, id', [t.id]),
      db.all('SELECT c.*, u.name AS user_name, u.avatar_color FROM comments c JOIN users u ON u.id = c.user_id WHERE c.task_id = ? ORDER BY c.id', [t.id]),
      db.all('SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.task_id = ? ORDER BY a.id DESC LIMIT 50', [t.id]),
      full(t.id),
      perms(req.user, t),
    ]);
    res.json({ ...detail, checklist: checklist.map((c) => ({ ...c, done: !!c.done, required: !!c.required })), comments, activity, ...p });
  });

  // ---- create -----------------------------------------------------------
  r.post('/', async (req, res) => {
    const b = req.body || {};
    const title = requiredString(b.title, 'title', 300);
    const projectId = optionalId(b.project_id, 'project_id') ?? null;
    await checkProject(req.user, projectId);
    const assigneeId = b.assignee_id === undefined ? req.user.id : optionalId(b.assignee_id, 'assignee_id');
    await checkAssignee(req.user, assigneeId, projectId);
    const reviewerId = optionalId(b.reviewer_id, 'reviewer_id') ?? null;
    await checkReviewer(reviewerId);
    const status = b.status ? oneOf(b.status, keys(STATUSES), 'status') : 'todo';
    if (status === 'in_review' && !reviewerId) throw badRequest('Pick a reviewer before sending a task to review');
    if (status === 'done' && reviewerId) throw badRequest('Tasks with a reviewer must be approved before they are done');
    const values = [
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
      b.estimate_hours === undefined ? null : estimate(b.estimate_hours),
      normaliseTags(b.tags) ?? '',
      tracks(b.track),
      status === 'done' ? nowUtc() : null,
    ];

    // Without a checklist of its own, a task starts with its type's SOP.
    const checklist = Array.isArray(b.checklist) ? b.checklist : await stepsFor(db, values[3], req.user.language);

    const id = await db.tx(async (tx) => {
      const task = await tx.get(
        `INSERT INTO tasks (project_id, title, description, type, status, priority, assignee_id, reporter_id, reviewer_id, start_date, due_date, estimate_hours, tags, track, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        values,
      );
      await log(tx, task, req.user.id, 'created', title);
      await notify(tx, req.user, assigneeId, 'assigned', `${req.user.name} assigned you "${title}"`, task.id, title);
      if (status === 'in_review') {
        await notify(tx, req.user, reviewerId, 'review_requested', `${req.user.name} requested your review on "${title}"`, task.id, title);
      }
      const items = checklistItems(checklist);
      if (items.length) {
        await tx.run(
          'INSERT INTO checklist_items (task_id, text, required, position) SELECT ?, i.text, i.required::int, i.pos - 1 FROM unnest(?::text[], ?::boolean[]) WITH ORDINALITY AS i(text, required, pos)',
          [task.id, items.map((i) => i.text), items.map((i) => i.required)],
        );
        if (status === 'in_review' || status === 'done') await checkRequiredSteps(tx, task.id);
      }
      return task.id;
    });
    await respond(req, res, id, 201);
  });

  // ---- create many (a content plan) ---------------------------------------
  // The same settings for every item; each item has its own title and due date.
  r.post('/batch', async (req, res) => {
    const b = req.body || {};
    if (!Array.isArray(b.items) || !b.items.length) throw badRequest('Add at least one item');
    if (b.items.length > 100) throw badRequest('Add at most 100 items at a time');
    const items = b.items.map((it) => ({ title: requiredString(it?.title, 'title', 300), due: optionalDate(it?.due_date, 'due_date') ?? null }));
    const projectId = optionalId(b.project_id, 'project_id') ?? null;
    await checkProject(req.user, projectId);
    const assigneeId = b.assignee_id === undefined ? req.user.id : optionalId(b.assignee_id, 'assignee_id') ?? null;
    await checkAssignee(req.user, assigneeId, projectId);
    const reviewerId = optionalId(b.reviewer_id, 'reviewer_id') ?? null;
    await checkReviewer(reviewerId);
    const type = b.type ? oneOf(b.type, keys(TASK_TYPES), 'type') : 'general';
    const priority = b.priority ? oneOf(b.priority, keys(PRIORITIES), 'priority') : 'medium';
    const steps = checklistItems(Array.isArray(b.checklist) ? b.checklist : await stepsFor(db, type, req.user.language));

    const ids = await db.tx(async (tx) => {
      const rows = await tx.all(
        `INSERT INTO tasks (project_id, title, description, type, priority, assignee_id, reporter_id, reviewer_id, due_date, tags, track)
         SELECT ?, i.title, ?, ?, ?, ?, ?, ?, i.due, ?, ? FROM unnest(?::text[], ?::text[]) WITH ORDINALITY AS i(title, due, n)
         ORDER BY i.n RETURNING id, title`,
        [projectId, String(b.description || ''), type, priority, assigneeId, req.user.id, reviewerId, normaliseTags(b.tags) ?? '', tracks(b.track), items.map((i) => i.title), items.map((i) => i.due)],
      );
      const taskIds = rows.map((r) => r.id);
      await tx.run(
        "INSERT INTO activity (task_id, project_id, user_id, action, detail) SELECT a.id, ?, ?, 'created', a.title FROM unnest(?::int[], ?::text[]) AS a(id, title)",
        [projectId, req.user.id, taskIds, rows.map((r) => r.title)],
      );
      if (steps.length) {
        await tx.run(
          'INSERT INTO checklist_items (task_id, text, required, position) SELECT t.id, s.text, s.required::int, s.pos - 1 FROM unnest(?::int[]) AS t(id) CROSS JOIN unnest(?::text[], ?::boolean[]) WITH ORDINALITY AS s(text, required, pos)',
          [taskIds, steps.map((s) => s.text), steps.map((s) => s.required)],
        );
      }
      const title = rows.length > 1 ? `${rows[0].title} (+${rows.length - 1})` : rows[0].title;
      await notify(tx, req.user, assigneeId, 'assigned', `${req.user.name} assigned you "${title}"`, rows[0].id, title);
      return taskIds;
    });
    res.status(201).json({ ids });
  });

  // ---- update -----------------------------------------------------------
  r.patch('/:id', async (req, res) => {
    const t = await loadEditable(req);
    const b = req.body || {};
    const f = {};
    if (b.title !== undefined) f.title = requiredString(b.title, 'title', 300);
    if (b.description !== undefined) f.description = String(b.description || '');
    if (b.type !== undefined) f.type = oneOf(b.type, keys(TASK_TYPES), 'type');
    if (b.priority !== undefined) f.priority = oneOf(b.priority, keys(PRIORITIES), 'priority');
    if (b.start_date !== undefined) f.start_date = optionalDate(b.start_date, 'start_date');
    if (b.due_date !== undefined) f.due_date = optionalDate(b.due_date, 'due_date');
    if (b.estimate_hours !== undefined) f.estimate_hours = estimate(b.estimate_hours);
    if (b.tags !== undefined) f.tags = normaliseTags(b.tags);
    if (b.track !== undefined) f.track = tracks(b.track);
    if (b.project_id !== undefined) {
      f.project_id = optionalId(b.project_id, 'project_id');
      await checkProject(req.user, f.project_id);
    }
    if (b.assignee_id !== undefined) {
      f.assignee_id = optionalId(b.assignee_id, 'assignee_id');
      if (f.assignee_id !== t.assignee_id) await checkAssignee(req.user, f.assignee_id, f.project_id !== undefined ? f.project_id : t.project_id);
    }
    if (b.reviewer_id !== undefined) {
      f.reviewer_id = optionalId(b.reviewer_id, 'reviewer_id');
      if (f.reviewer_id !== t.reviewer_id && !(await access.canChangeReviewer(req.user, t))) {
        throw forbidden('Only the task creator, the reviewer or a manager can change who reviews this task');
      }
      await checkReviewer(f.reviewer_id);
    }
    const reviewerId = f.reviewer_id !== undefined ? f.reviewer_id : t.reviewer_id;
    // Finishing is judged against the reviewer the task had before this edit, so a
    // reviewer can't be removed and the task completed in the same request.
    const gatekeeper = t.reviewer_id ?? reviewerId;
    if (b.status !== undefined) {
      f.status = oneOf(b.status, keys(STATUSES), 'status');
      if (f.status === 'in_review' && !reviewerId) throw badRequest('Pick a reviewer before sending a task to review');
      if (f.status === 'done' && t.status !== 'done' && gatekeeper && !access.canReviewTask(req.user, { ...t, reviewer_id: gatekeeper })) {
        throw badRequest('This task has a reviewer — send it to review so they can approve it');
      }
      if ((f.status === 'in_review' || f.status === 'done') && f.status !== t.status && t.status !== 'done') await checkRequiredSteps(db, t.id);
      if (f.status === 'done' && t.status !== 'done') f.completed_at = nowUtc();
      if (f.status !== 'done') f.completed_at = null;
    }

    const changed = Object.keys(f).filter((k) => f[k] !== t[k]);
    if (!changed.length) return respond(req, res, t.id);

    await db.tx(async (tx) => {
      const updated = await tx.get(`UPDATE tasks SET ${changed.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? RETURNING *`, [
        ...changed.map((k) => f[k]),
        nowUtc(),
        t.id,
      ]);
      const title = updated.title;
      const nameOf = async (id, fallback) => (id ? (await userById(id, tx)).name : fallback);
      for (const k of changed) {
        if (k === 'completed_at' || k === 'description') continue;
        if (k === 'status') await log(tx, updated, req.user.id, 'status', `${t.status}→${f.status}`);
        else if (k === 'assignee_id') await log(tx, updated, req.user.id, 'assigned', await nameOf(f.assignee_id, 'Unassigned'));
        else if (k === 'reviewer_id') await log(tx, updated, req.user.id, 'reviewer', await nameOf(f.reviewer_id, 'None'));
        else if (k === 'project_id') {
          const name = f.project_id ? (await projectById(f.project_id, tx)).name : 'none';
          await log(tx, updated, req.user.id, 'updated', `project: ${name}`);
        } else await log(tx, updated, req.user.id, 'updated', `${k.replace('_', ' ')}${f[k] ? `: ${f[k]}` : ' cleared'}`);
      }
      if (changed.includes('description')) await log(tx, updated, req.user.id, 'updated', 'description');

      if (changed.includes('assignee_id')) await notify(tx, req.user, f.assignee_id, 'assigned', `${req.user.name} assigned you "${title}"`, t.id, title);
      if (changed.includes('status')) {
        if (f.status === 'in_review') {
          await notify(tx, req.user, reviewerId, 'review_requested', `${req.user.name} requested your review on "${title}"`, t.id, title);
        }
        if (f.status === 'done') {
          await notify(tx, req.user, t.reporter_id, 'completed', `${req.user.name} completed "${title}"`, t.id, title);
          await notify(tx, req.user, updated.assignee_id, 'completed', `${req.user.name} marked "${title}" done`, t.id, title);
        }
        if (f.status === 'blocked') await notify(tx, req.user, t.reporter_id, 'blocked', `"${title}" is blocked`, t.id, title);
      }
    });
    await respond(req, res, t.id);
  });

  r.delete('/:id', async (req, res) => {
    const t = await loadVisible(req);
    if (!(await access.canDeleteTask(req.user, t))) throw forbidden('Only the creator, their managers or the project owner can delete this task');
    await db.run('DELETE FROM tasks WHERE id = ?', [t.id]);
    res.status(204).end();
  });

  // ---- review workflow ---------------------------------------------------
  r.post('/:id/review', async (req, res) => {
    const t = await loadVisible(req);
    if (!access.canReviewTask(req.user, t)) throw forbidden('Only the reviewer can approve this task');
    if (t.status !== 'in_review') throw badRequest('Task is not waiting for review');
    const decision = oneOf(req.body?.decision, ['approve', 'changes'], 'decision');
    const comment = String(req.body?.comment || '').trim();
    if (decision === 'changes' && !comment) throw badRequest('Explain what needs to change');
    await db.tx(async (tx) => {
      // Only one decision wins if two arrive together.
      const now = nowUtc();
      const moved =
        decision === 'approve'
          ? await tx.run("UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'in_review'", [now, now, t.id])
          : await tx.run("UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ? AND status = 'in_review'", [now, t.id]);
      if (!moved.rowCount) throw badRequest('Task is not waiting for review');
      if (decision === 'approve') {
        await log(tx, t, req.user.id, 'approved', comment);
        await notify(tx, req.user, t.assignee_id, 'approved', `${req.user.name} approved "${t.title}"`, t.id, t.title);
        await notify(tx, req.user, t.reporter_id, 'approved', `${req.user.name} approved "${t.title}"`, t.id, t.title);
      } else {
        await log(tx, t, req.user.id, 'changes_requested', comment);
        await notify(tx, req.user, t.assignee_id, 'changes_requested', `${req.user.name} requested changes on "${t.title}"`, t.id, t.title);
      }
      if (comment) {
        // Written in the reviewer's language, like the rest of what they type.
        const lang = req.user.language === 'ar' ? 'ar' : 'en';
        const prefix = translate(lang, decision === 'approve' ? 'review.approvedPrefix' : 'review.changesPrefix');
        await tx.run('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)', [t.id, req.user.id, `${prefix}: ${comment}`]);
      }
    });
    await respond(req, res, t.id);
  });

  // ---- comments ----------------------------------------------------------
  r.post('/:id/comments', async (req, res) => {
    const t = await loadVisible(req);
    const body = requiredString(req.body?.body, 'comment', 5000);
    const id = await db.tx(async (tx) => {
      const c = await tx.get('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?) RETURNING id', [t.id, req.user.id, body]);
      for (const uid of new Set([t.assignee_id, t.reporter_id, t.reviewer_id])) {
        await notify(tx, req.user, uid, 'comment', `${req.user.name} commented on "${t.title}"`, t.id, t.title);
      }
      return c.id;
    });
    const c = await db.get('SELECT c.*, u.name AS user_name, u.avatar_color FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?', [id]);
    res.status(201).json(c);
  });

  r.delete('/:id/comments/:commentId', async (req, res) => {
    const t = await loadVisible(req);
    const c = await db.get('SELECT * FROM comments WHERE id = ? AND task_id = ?', [idParam(req.params.commentId), t.id]);
    if (!c) throw notFound('Comment not found');
    if (c.user_id !== req.user.id && req.user.role !== 'ceo') throw forbidden('You can only delete your own comments');
    await db.run('DELETE FROM comments WHERE id = ?', [c.id]);
    res.status(204).end();
  });

  // ---- checklist ---------------------------------------------------------
  const item = async (t, id) => {
    const c = await db.get('SELECT * FROM checklist_items WHERE id = ? AND task_id = ?', [idParam(id), t.id]);
    if (!c) throw notFound('Checklist item not found');
    return c;
  };

  r.post('/:id/checklist', async (req, res) => {
    const t = await loadEditable(req);
    const text = requiredString(req.body?.text, 'text', 500);
    const c = await db.get(
      `INSERT INTO checklist_items (task_id, text, position)
       VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM checklist_items WHERE task_id = ?)) RETURNING *`,
      [t.id, text, t.id],
    );
    res.status(201).json({ ...c, done: !!c.done });
  });

  // Appends the task type's SOP steps (with their required marks) to the checklist.
  r.post('/:id/checklist/sop', async (req, res) => {
    const t = await loadEditable(req);
    const steps = checklistItems(await stepsFor(db, t.type, req.user.language));
    if (!steps.length) throw badRequest('This type has no SOP steps');
    await db.run(
      `INSERT INTO checklist_items (task_id, text, required, position)
       SELECT ?, s.text, s.required::int, s.pos - 1 + (SELECT COALESCE(MAX(position), -1) + 1 FROM checklist_items WHERE task_id = ?)
       FROM unnest(?::text[], ?::boolean[]) WITH ORDINALITY AS s(text, required, pos)`,
      [t.id, t.id, steps.map((s) => s.text), steps.map((s) => s.required)],
    );
    res.status(201).json({ added: steps.length });
  });

  r.patch('/:id/checklist/:itemId', async (req, res) => {
    const t = await loadEditable(req);
    const c = await item(t, req.params.itemId);
    const text = req.body?.text !== undefined ? requiredString(req.body.text, 'text', 500) : c.text;
    const done = req.body?.done !== undefined ? (req.body.done ? 1 : 0) : c.done;
    await db.run('UPDATE checklist_items SET text = ?, done = ? WHERE id = ?', [text, done, c.id]);
    res.json({ ...c, text, done: !!done });
  });

  r.delete('/:id/checklist/:itemId', async (req, res) => {
    const t = await loadEditable(req);
    const c = await item(t, req.params.itemId);
    // Otherwise the assignee could skip a required step by deleting it.
    if (c.required && t.assignee_id === req.user.id && t.reporter_id !== req.user.id && req.user.role !== 'ceo') {
      throw forbidden('Only whoever created the task or a manager can remove a required SOP step');
    }
    await db.run('DELETE FROM checklist_items WHERE id = ?', [c.id]);
    res.status(204).end();
  });

  return r;
}

function rolesInDept(dept) {
  return Object.entries(ROLES)
    .filter(([, r]) => r.department === dept)
    .map(([k]) => k);
}
