// Offline centers, instructor availability collection and center schedules.
//
// - Everyone can see centers and the weekly schedule.
// - Center admins (Head of Company, Operations Manager, Head of Content) manage
//   centers, open availability rounds and assign instructors to centers.
// - Instructors submit their weekly availability for open rounds.
import { Router } from 'express';
import { HttpError, badRequest, forbidden, idParam, notFound, oneOf, optionalDate, optionalId, requiredString } from '../http.js';
import { CENTER_ADMIN_ROLES, WEEKDAYS } from '../meta.js';
import { nowUtc } from '../time.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const isAdmin = (user) => CENTER_ADMIN_ROLES.includes(user.role);
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const json = (s, fallback) => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

const timesOverlap = (a, b) => a.start_time < b.end_time && b.start_time < a.end_time;
const datesOverlap = (a, b) => (!a.starts_on || !b.ends_on || a.starts_on <= b.ends_on) && (!b.starts_on || !a.ends_on || b.starts_on <= a.ends_on);

function time(v, field) {
  if (!TIME_RE.test(v || '')) throw badRequest(`${field} must be a time like 09:30`);
  return v;
}

function cleanSlots(slots) {
  if (!Array.isArray(slots)) throw badRequest('slots must be a list');
  if (slots.length > 60) throw badRequest('Too many time slots');
  return slots.map((s) => {
    const day = oneOf(s?.day, WEEKDAYS, 'day');
    const start = time(s.start, 'start');
    const end = time(s.end, 'end');
    if (end <= start) throw badRequest('Each time slot must end after it starts');
    return { day, start, end };
  });
}

export default function centerRoutes({ db }) {
  const r = Router();
  const notify = (q, userId, type, message, params) =>
    q.run('INSERT INTO notifications (user_id, type, message, link, params) VALUES (?, ?, ?, ?, ?)', [
      userId,
      type,
      message,
      '/centers?tab=mine',
      JSON.stringify(params),
    ]);
  const centerById = (id, q = db) => q.get('SELECT * FROM centers WHERE id = ?', [id]);
  const roundById = (id, q = db) => q.get('SELECT * FROM availability_rounds WHERE id = ?', [id]);
  const instructors = (q = db) => q.all("SELECT id, name, avatar_color, title FROM users WHERE role = 'instructor' AND active = 1 ORDER BY name");
  const requireAdmin = (user) => {
    if (!isAdmin(user)) throw forbidden('Only the Head of Company, Operations Manager or Head of Content can do this');
  };

  const parseAvailability = (a) => a && { ...a, slots: json(a.slots, []), center_ids: json(a.center_ids, []) };

  async function loadRound(id) {
    const round = await roundById(idParam(id));
    if (!round) throw notFound('Availability round not found');
    return round;
  }

  // ---- centers -------------------------------------------------------------
  const CENTER_SELECT = `
    SELECT c.*,
      (SELECT COUNT(*) FROM center_assignments a WHERE a.center_id = c.id) AS sessions,
      (SELECT COUNT(DISTINCT a.instructor_id) FROM center_assignments a WHERE a.center_id = c.id) AS instructor_count
    FROM centers c`;

  function centerFields(b, existing = {}) {
    const f = {};
    if (b.name !== undefined || !existing.id) f.name = requiredString(b.name, 'name', 200);
    for (const k of ['city', 'address', 'phone', 'contact_name', 'notes']) if (b[k] !== undefined) f[k] = str(b[k], k === 'notes' ? 2000 : 300);
    if (b.capacity !== undefined) {
      const n = Number(b.capacity);
      if (!Number.isInteger(n) || n < 1 || n > 100) throw badRequest('capacity must be a number of rooms between 1 and 100');
      f.capacity = n;
    }
    if (b.active !== undefined) f.active = b.active ? 1 : 0;
    return f;
  }

  r.get('/', async (req, res) => {
    const where = req.query.all === '1' ? '' : 'WHERE c.active = 1';
    const centers = await db.all(`${CENTER_SELECT} ${where} ORDER BY c.active DESC, c.city, c.name`);
    res.json({ centers: centers.map((c) => ({ ...c, active: !!c.active })), can_manage: isAdmin(req.user) });
  });

  r.post('/', async (req, res) => {
    requireAdmin(req.user);
    const f = centerFields(req.body || {});
    const k = Object.keys(f);
    const { id } = await db.get(`INSERT INTO centers (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')}) RETURNING id`, k.map((x) => f[x]));
    res.status(201).json(await db.get(`${CENTER_SELECT} WHERE c.id = ?`, [id]));
  });

  r.patch('/:id', async (req, res) => {
    requireAdmin(req.user);
    const c = await centerById(idParam(req.params.id));
    if (!c) throw notFound('Center not found');
    const f = centerFields(req.body || {}, c);
    const k = Object.keys(f);
    if (k.length) await db.run(`UPDATE centers SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`, [...k.map((x) => f[x]), c.id]);
    res.json(await db.get(`${CENTER_SELECT} WHERE c.id = ?`, [c.id]));
  });

  r.delete('/:id', async (req, res) => {
    requireAdmin(req.user);
    const c = await centerById(idParam(req.params.id));
    if (!c) throw notFound('Center not found');
    await db.run('DELETE FROM centers WHERE id = ?', [c.id]);
    res.status(204).end();
  });

  // ---- availability rounds -------------------------------------------------
  r.get('/rounds', async (req, res) => {
    const [people, rounds] = await Promise.all([
      instructors(),
      db.all(
        `SELECT r.*, u.name AS created_by_name, (SELECT COUNT(*) FROM availability a WHERE a.round_id = r.id) AS submitted,
          (SELECT COUNT(*) FROM availability a WHERE a.round_id = r.id AND a.instructor_id = ?) AS mine
         FROM availability_rounds r JOIN users u ON u.id = r.created_by ORDER BY r.status = 'open' DESC, r.id DESC`,
        [req.user.id],
      ),
    ]);
    res.json({ rounds: rounds.map((x) => ({ ...x, total: people.length, mine: !!x.mine })), can_manage: isAdmin(req.user) });
  });

  r.post('/rounds', async (req, res) => {
    requireAdmin(req.user);
    const b = req.body || {};
    const title = requiredString(b.title, 'title', 200);
    const dates = [optionalDate(b.starts_on, 'starts_on') ?? null, optionalDate(b.ends_on, 'ends_on') ?? null, optionalDate(b.due_date, 'due_date') ?? null];
    const round = await db.tx(async (tx) => {
      const created = await tx.get(
        'INSERT INTO availability_rounds (title, starts_on, ends_on, due_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
        [title, ...dates, str(b.notes, 2000), req.user.id],
      );
      for (const i of await instructors(tx)) {
        await notify(tx, i.id, 'availability_requested', `${req.user.name} asked for your availability: "${title}"`, { actor: req.user.name, title });
      }
      return created;
    });
    res.status(201).json(round);
  });

  r.patch('/rounds/:id', async (req, res) => {
    requireAdmin(req.user);
    const round = await loadRound(req.params.id);
    const b = req.body || {};
    const f = {};
    if (b.title !== undefined) f.title = requiredString(b.title, 'title', 200);
    if (b.status !== undefined) f.status = oneOf(b.status, ['open', 'closed'], 'status');
    for (const k of ['starts_on', 'ends_on', 'due_date']) if (b[k] !== undefined) f[k] = optionalDate(b[k], k);
    if (b.notes !== undefined) f.notes = str(b.notes, 2000);
    const k = Object.keys(f);
    if (k.length) await db.run(`UPDATE availability_rounds SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`, [...k.map((x) => f[x]), round.id]);
    res.json(await roundById(round.id));
  });

  r.delete('/rounds/:id', async (req, res) => {
    requireAdmin(req.user);
    await db.run('DELETE FROM availability_rounds WHERE id = ?', [idParam(req.params.id)]);
    res.status(204).end();
  });

  // Everyone's submissions for a round (admins only).
  r.get('/rounds/:id', async (req, res) => {
    requireAdmin(req.user);
    const round = await loadRound(req.params.id);
    const [subRows, loadRows, people] = await Promise.all([
      db.all('SELECT * FROM availability WHERE round_id = ?', [round.id]),
      db.all('SELECT instructor_id, COUNT(*) AS n FROM center_assignments GROUP BY instructor_id'),
      instructors(),
    ]);
    const subs = new Map(subRows.map((a) => [a.instructor_id, parseAvailability(a)]));
    const load = new Map(loadRows.map((x) => [x.instructor_id, x.n]));
    res.json({
      ...round,
      instructors: people.map((i) => ({ ...i, availability: subs.get(i.id) || null, sessions: load.get(i.id) || 0 })),
    });
  });

  r.post('/rounds/:id/remind', async (req, res) => {
    requireAdmin(req.user);
    const round = await loadRound(req.params.id);
    const reminded = await db.tx(async (tx) => {
      const done = new Set((await tx.all('SELECT instructor_id FROM availability WHERE round_id = ?', [round.id])).map((x) => x.instructor_id));
      const missing = (await instructors(tx)).filter((i) => !done.has(i.id));
      for (const i of missing) {
        await notify(tx, i.id, 'availability_reminder', `Reminder: please submit your availability for "${round.title}"`, {
          actor: req.user.name,
          title: round.title,
        });
      }
      return missing.length;
    });
    res.json({ reminded });
  });

  async function saveAvailability(round, instructorId, b, actor) {
    const slots = cleanSlots(b.slots ?? []);
    const wanted = Array.isArray(b.center_ids) ? [...new Set(b.center_ids.map(idParam))] : [];
    const centerIds = (await db.all('SELECT id FROM centers WHERE id = ANY(?::int[]) ORDER BY id', [wanted])).map((c) => c.id);
    let max = null;
    if (b.max_sessions !== undefined && b.max_sessions !== null && b.max_sessions !== '') {
      max = Number(b.max_sessions);
      if (!Number.isInteger(max) || max < 0 || max > 50) throw badRequest('max_sessions must be between 0 and 50');
    }
    const saved = await db.get(
      `INSERT INTO availability (round_id, instructor_id, slots, center_ids, max_sessions, notes, submitted_by, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (round_id, instructor_id) DO UPDATE SET slots = excluded.slots, center_ids = excluded.center_ids,
         max_sessions = excluded.max_sessions, notes = excluded.notes, submitted_by = excluded.submitted_by, submitted_at = excluded.submitted_at
       RETURNING *`,
      [round.id, instructorId, JSON.stringify(slots), JSON.stringify(centerIds), max, str(b.notes, 2000), actor.id, nowUtc()],
    );
    return parseAvailability(saved);
  }

  r.get('/rounds/:id/mine', async (req, res) => {
    const round = await loadRound(req.params.id);
    const a = await db.get('SELECT * FROM availability WHERE round_id = ? AND instructor_id = ?', [round.id, req.user.id]);
    res.json({ round, availability: parseAvailability(a) || null });
  });

  r.put('/rounds/:id/mine', async (req, res) => {
    if (req.user.role !== 'instructor') throw forbidden('Only instructors submit availability');
    const round = await loadRound(req.params.id);
    if (round.status !== 'open') throw badRequest('This availability round is closed');
    res.json(await saveAvailability(round, req.user.id, req.body || {}, req.user));
  });

  // Admins can record availability collected by phone or message.
  r.put('/rounds/:id/availability/:instructorId', async (req, res) => {
    requireAdmin(req.user);
    const round = await loadRound(req.params.id);
    const instructorId = idParam(req.params.instructorId);
    if (!(await instructors()).some((i) => i.id === instructorId)) throw badRequest('Instructor not found');
    res.json(await saveAvailability(round, instructorId, req.body || {}, req.user));
  });

  // ---- assignments ---------------------------------------------------------
  const ASSIGN_SELECT = `
    SELECT a.*, c.name AS center_name, c.city AS center_city, u.name AS instructor_name, u.avatar_color AS instructor_color
    FROM center_assignments a JOIN centers c ON c.id = a.center_id JOIN users u ON u.id = a.instructor_id`;

  r.get('/assignments', async (req, res) => {
    const where = ['TRUE'];
    const params = [];
    if (req.query.center_id) where.push('a.center_id = ?'), params.push(idParam(req.query.center_id));
    if (req.query.instructor_id) where.push('a.instructor_id = ?'), params.push(req.query.instructor_id === 'me' ? req.user.id : idParam(req.query.instructor_id));
    if (req.query.day) where.push('a.day = ?'), params.push(String(req.query.day));
    const order = `CASE a.day ${WEEKDAYS.map((d, i) => `WHEN '${d}' THEN ${i}`).join(' ')} END, a.start_time`;
    res.json(await db.all(`${ASSIGN_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}`, params));
  });

  function assignmentFields(b, existing = {}) {
    const merged = { ...existing };
    if (b.center_id !== undefined || !existing.id) merged.center_id = optionalId(b.center_id, 'center_id');
    if (b.instructor_id !== undefined || !existing.id) merged.instructor_id = optionalId(b.instructor_id, 'instructor_id');
    if (b.day !== undefined || !existing.id) merged.day = oneOf(b.day, WEEKDAYS, 'day');
    if (b.start_time !== undefined || !existing.id) merged.start_time = time(b.start_time, 'start_time');
    if (b.end_time !== undefined || !existing.id) merged.end_time = time(b.end_time, 'end_time');
    if (b.subject !== undefined) merged.subject = str(b.subject, 200);
    if (b.notes !== undefined) merged.notes = str(b.notes, 2000);
    if (b.starts_on !== undefined) merged.starts_on = optionalDate(b.starts_on, 'starts_on');
    if (b.ends_on !== undefined) merged.ends_on = optionalDate(b.ends_on, 'ends_on');
    if (b.round_id !== undefined) merged.round_id = optionalId(b.round_id, 'round_id');
    if (!merged.center_id) throw badRequest('Choose a center');
    if (!merged.instructor_id) throw badRequest('Choose an instructor');
    if (merged.end_time <= merged.start_time) throw badRequest('The session must end after it starts');
    if (merged.starts_on && merged.ends_on && merged.ends_on < merged.starts_on) throw badRequest('The end date must be after the start date');
    return merged;
  }

  // Hard conflicts always block; warnings block unless the request says force.
  // Runs inside the transaction that saves the session; the day's sessions are
  // locked so two admins can't double-book the same slot at once.
  async function checkAssignment(q, a, force) {
    const center = await centerById(a.center_id, q);
    if (!center) throw badRequest('Center not found');
    if (!center.active) throw badRequest('This center is inactive');
    const inst = await q.get("SELECT id, name FROM users WHERE id = ? AND role = 'instructor' AND active = 1", [a.instructor_id]);
    if (!inst) throw badRequest('Instructor not found');

    await q.run('SELECT pg_advisory_xact_lock(4243, ?)', [WEEKDAYS.indexOf(a.day)]);
    const sameDay = (await q.all(`${ASSIGN_SELECT} WHERE a.day = ? AND a.id != ?`, [a.day, a.id || 0])).filter(
      (x) => timesOverlap(x, a) && datesOverlap(x, a),
    );
    const clash = sameDay.find((x) => x.instructor_id === a.instructor_id);
    if (clash) {
      throw new HttpError(409, `${inst.name} already teaches at ${clash.center_name} ${clash.start_time}–${clash.end_time} on that day`, 'instructor_busy', {
        center: clash.center_name,
        start: clash.start_time,
        end: clash.end_time,
      });
    }
    if (force) return;

    const used = sameDay.filter((x) => x.center_id === a.center_id).length;
    if (used >= center.capacity) {
      throw new HttpError(409, `${center.name} has no free room at that time (${center.capacity} room(s))`, 'center_full', { capacity: center.capacity });
    }

    const round = a.round_id
      ? await roundById(a.round_id, q)
      : await q.get("SELECT * FROM availability_rounds ORDER BY status = 'open' DESC, id DESC LIMIT 1");
    if (!round) return;
    const sub = parseAvailability(await q.get('SELECT * FROM availability WHERE round_id = ? AND instructor_id = ?', [round.id, a.instructor_id]));
    if (!sub) throw new HttpError(409, `${inst.name} has not submitted availability for "${round.title}"`, 'no_availability', { round: round.title });
    const covered = sub.slots.some((s) => s.day === a.day && s.start <= a.start_time && s.end >= a.end_time);
    if (!covered) {
      throw new HttpError(409, `${inst.name} is not available at that time`, 'outside_availability', {
        slots: sub.slots.filter((s) => s.day === a.day),
      });
    }
    if (sub.max_sessions != null) {
      const { n } = await q.get('SELECT COUNT(*) AS n FROM center_assignments WHERE instructor_id = ? AND id != ?', [a.instructor_id, a.id || 0]);
      if (n >= sub.max_sessions) throw new HttpError(409, `${inst.name} asked for at most ${sub.max_sessions} sessions a week`, 'max_sessions', { max: sub.max_sessions });
    }
  }

  const DAY_LABEL = { sat: 'Saturday', sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };

  const notifyAssigned = (q, actor, a, centerName) =>
    notify(q, a.instructor_id, 'center_assigned', `${actor.name} assigned you to ${centerName} on ${DAY_LABEL[a.day]} ${a.start_time}–${a.end_time}`, {
      actor: actor.name,
      center: centerName,
      day: a.day,
      start: a.start_time,
      end: a.end_time,
    });

  const assignmentValues = (a) => [
    a.center_id,
    a.instructor_id,
    a.day,
    a.start_time,
    a.end_time,
    a.subject || '',
    a.round_id || null,
    a.starts_on || null,
    a.ends_on || null,
    a.notes || '',
  ];

  r.post('/assignments', async (req, res) => {
    requireAdmin(req.user);
    const a = assignmentFields(req.body || {});
    const created = await db.tx(async (tx) => {
      await checkAssignment(tx, a, !!req.body?.force);
      const { id } = await tx.get(
        `INSERT INTO center_assignments (center_id, instructor_id, day, start_time, end_time, subject, round_id, starts_on, ends_on, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [...assignmentValues(a), req.user.id],
      );
      const row = await tx.get(`${ASSIGN_SELECT} WHERE a.id = ?`, [id]);
      if (a.instructor_id !== req.user.id) await notifyAssigned(tx, req.user, a, row.center_name);
      return row;
    });
    res.status(201).json(created);
  });

  r.patch('/assignments/:id', async (req, res) => {
    requireAdmin(req.user);
    const existing = await db.get('SELECT * FROM center_assignments WHERE id = ?', [idParam(req.params.id)]);
    if (!existing) throw notFound('Assignment not found');
    const a = assignmentFields(req.body || {}, existing);
    const updated = await db.tx(async (tx) => {
      await checkAssignment(tx, a, !!req.body?.force);
      await tx.run(
        `UPDATE center_assignments SET center_id = ?, instructor_id = ?, day = ?, start_time = ?, end_time = ?, subject = ?, round_id = ?,
           starts_on = ?, ends_on = ?, notes = ? WHERE id = ?`,
        [...assignmentValues(a), existing.id],
      );
      const row = await tx.get(`${ASSIGN_SELECT} WHERE a.id = ?`, [existing.id]);
      const changed = ['center_id', 'instructor_id', 'day', 'start_time', 'end_time'].some((k) => existing[k] !== a[k]);
      if (changed && a.instructor_id !== req.user.id) await notifyAssigned(tx, req.user, a, row.center_name);
      return row;
    });
    res.json(updated);
  });

  r.delete('/assignments/:id', async (req, res) => {
    requireAdmin(req.user);
    const existing = await db.get(`${ASSIGN_SELECT} WHERE a.id = ?`, [idParam(req.params.id)]);
    if (!existing) throw notFound('Assignment not found');
    await db.tx(async (tx) => {
      await tx.run('DELETE FROM center_assignments WHERE id = ?', [existing.id]);
      if (existing.instructor_id !== req.user.id) {
        await notify(
          tx,
          existing.instructor_id,
          'center_unassigned',
          `${req.user.name} removed your session at ${existing.center_name} on ${DAY_LABEL[existing.day]} ${existing.start_time}`,
          { actor: req.user.name, center: existing.center_name, day: existing.day, start: existing.start_time, end: existing.end_time },
        );
      }
    });
    res.status(204).end();
  });

  return r;
}
