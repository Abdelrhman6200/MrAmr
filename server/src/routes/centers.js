// Offline centers, instructor availability collection and center schedules.
//
// - Everyone can see centers and the weekly schedule.
// - Center admins (Head of Company, Operations Manager, Head of Content) manage
//   centers, open availability rounds and assign instructors to centers.
// - Instructors submit their weekly availability for open rounds.
import { Router } from 'express';
import { transaction } from '../db.js';
import { HttpError, badRequest, forbidden, notFound, oneOf, optionalDate, optionalId, requiredString } from '../http.js';
import { CENTER_ADMIN_ROLES, WEEKDAYS } from '../meta.js';

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
  const notify = db.prepare('INSERT INTO notifications (user_id, type, message, link, params) VALUES (?, ?, ?, ?, ?)');
  const centerById = db.prepare('SELECT * FROM centers WHERE id = ?');
  const roundById = db.prepare('SELECT * FROM availability_rounds WHERE id = ?');
  const instructors = () => db.prepare("SELECT id, name, avatar_color, title FROM users WHERE role = 'instructor' AND active = 1 ORDER BY name").all();
  const requireAdmin = (user) => {
    if (!isAdmin(user)) throw forbidden('Only the Head of Company, Operations Manager or Head of Content can do this');
  };

  const parseAvailability = (a) => a && { ...a, slots: json(a.slots, []), center_ids: json(a.center_ids, []) };

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

  r.get('/', (req, res) => {
    const where = req.query.all === '1' ? '' : 'WHERE c.active = 1';
    res.json({ centers: db.prepare(`${CENTER_SELECT} ${where} ORDER BY c.active DESC, c.city, c.name`).all().map((c) => ({ ...c, active: !!c.active })), can_manage: isAdmin(req.user) });
  });

  r.post('/', (req, res) => {
    requireAdmin(req.user);
    const f = centerFields(req.body || {});
    const k = Object.keys(f);
    const info = db.prepare(`INSERT INTO centers (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`).run(...k.map((x) => f[x]));
    res.status(201).json(db.prepare(`${CENTER_SELECT} WHERE c.id = ?`).get(Number(info.lastInsertRowid)));
  });

  r.patch('/:id', (req, res) => {
    requireAdmin(req.user);
    const c = centerById.get(Number(req.params.id));
    if (!c) throw notFound('Center not found');
    const f = centerFields(req.body || {}, c);
    const k = Object.keys(f);
    if (k.length) db.prepare(`UPDATE centers SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`).run(...k.map((x) => f[x]), c.id);
    res.json(db.prepare(`${CENTER_SELECT} WHERE c.id = ?`).get(c.id));
  });

  r.delete('/:id', (req, res) => {
    requireAdmin(req.user);
    const c = centerById.get(Number(req.params.id));
    if (!c) throw notFound('Center not found');
    db.prepare('DELETE FROM centers WHERE id = ?').run(c.id);
    res.status(204).end();
  });

  // ---- availability rounds -------------------------------------------------
  r.get('/rounds', (req, res) => {
    const total = instructors().length;
    const rounds = db
      .prepare(
        `SELECT r.*, u.name AS created_by_name, (SELECT COUNT(*) FROM availability a WHERE a.round_id = r.id) AS submitted,
          (SELECT COUNT(*) FROM availability a WHERE a.round_id = r.id AND a.instructor_id = ?) AS mine
         FROM availability_rounds r JOIN users u ON u.id = r.created_by ORDER BY r.status = 'open' DESC, r.id DESC`,
      )
      .all(req.user.id);
    res.json({ rounds: rounds.map((x) => ({ ...x, total, mine: !!x.mine })), can_manage: isAdmin(req.user) });
  });

  r.post('/rounds', (req, res) => {
    requireAdmin(req.user);
    const b = req.body || {};
    const title = requiredString(b.title, 'title', 200);
    const id = transaction(db, () => {
      const info = db
        .prepare('INSERT INTO availability_rounds (title, starts_on, ends_on, due_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(title, optionalDate(b.starts_on, 'starts_on') ?? null, optionalDate(b.ends_on, 'ends_on') ?? null, optionalDate(b.due_date, 'due_date') ?? null, str(b.notes, 2000), req.user.id);
      const rid = Number(info.lastInsertRowid);
      for (const i of instructors()) {
        notify.run(i.id, 'availability_requested', `${req.user.name} asked for your availability: "${title}"`, '/centers?tab=mine', JSON.stringify({ actor: req.user.name, title }));
      }
      return rid;
    });
    res.status(201).json(roundById.get(id));
  });

  r.patch('/rounds/:id', (req, res) => {
    requireAdmin(req.user);
    const round = roundById.get(Number(req.params.id));
    if (!round) throw notFound('Availability round not found');
    const b = req.body || {};
    const f = {};
    if (b.title !== undefined) f.title = requiredString(b.title, 'title', 200);
    if (b.status !== undefined) f.status = oneOf(b.status, ['open', 'closed'], 'status');
    for (const k of ['starts_on', 'ends_on', 'due_date']) if (b[k] !== undefined) f[k] = optionalDate(b[k], k);
    if (b.notes !== undefined) f.notes = str(b.notes, 2000);
    const k = Object.keys(f);
    if (k.length) db.prepare(`UPDATE availability_rounds SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`).run(...k.map((x) => f[x]), round.id);
    res.json(roundById.get(round.id));
  });

  r.delete('/rounds/:id', (req, res) => {
    requireAdmin(req.user);
    db.prepare('DELETE FROM availability_rounds WHERE id = ?').run(Number(req.params.id));
    res.status(204).end();
  });

  // Everyone's submissions for a round (admins only).
  r.get('/rounds/:id', (req, res) => {
    requireAdmin(req.user);
    const round = roundById.get(Number(req.params.id));
    if (!round) throw notFound('Availability round not found');
    const subs = new Map(db.prepare('SELECT * FROM availability WHERE round_id = ?').all(round.id).map((a) => [a.instructor_id, parseAvailability(a)]));
    const load = new Map(db.prepare('SELECT instructor_id, COUNT(*) AS n FROM center_assignments GROUP BY instructor_id').all().map((x) => [x.instructor_id, x.n]));
    res.json({
      ...round,
      instructors: instructors().map((i) => ({ ...i, availability: subs.get(i.id) || null, sessions: load.get(i.id) || 0 })),
    });
  });

  r.post('/rounds/:id/remind', (req, res) => {
    requireAdmin(req.user);
    const round = roundById.get(Number(req.params.id));
    if (!round) throw notFound('Availability round not found');
    const done = new Set(db.prepare('SELECT instructor_id FROM availability WHERE round_id = ?').all(round.id).map((x) => x.instructor_id));
    const missing = instructors().filter((i) => !done.has(i.id));
    for (const i of missing) {
      notify.run(i.id, 'availability_reminder', `Reminder: please submit your availability for "${round.title}"`, '/centers?tab=mine', JSON.stringify({ actor: req.user.name, title: round.title }));
    }
    res.json({ reminded: missing.length });
  });

  function saveAvailability(round, instructorId, b, actor) {
    const slots = cleanSlots(b.slots ?? []);
    const centerIds = Array.isArray(b.center_ids) ? [...new Set(b.center_ids.map(Number))].filter((id) => centerById.get(id)) : [];
    let max = null;
    if (b.max_sessions !== undefined && b.max_sessions !== null && b.max_sessions !== '') {
      max = Number(b.max_sessions);
      if (!Number.isInteger(max) || max < 0 || max > 50) throw badRequest('max_sessions must be between 0 and 50');
    }
    db.prepare(
      `INSERT INTO availability (round_id, instructor_id, slots, center_ids, max_sessions, notes, submitted_by, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (round_id, instructor_id) DO UPDATE SET slots = excluded.slots, center_ids = excluded.center_ids,
         max_sessions = excluded.max_sessions, notes = excluded.notes, submitted_by = excluded.submitted_by, submitted_at = excluded.submitted_at`,
    ).run(round.id, instructorId, JSON.stringify(slots), JSON.stringify(centerIds), max, str(b.notes, 2000), actor.id);
    return parseAvailability(db.prepare('SELECT * FROM availability WHERE round_id = ? AND instructor_id = ?').get(round.id, instructorId));
  }

  r.get('/rounds/:id/mine', (req, res) => {
    const round = roundById.get(Number(req.params.id));
    if (!round) throw notFound('Availability round not found');
    const a = db.prepare('SELECT * FROM availability WHERE round_id = ? AND instructor_id = ?').get(round.id, req.user.id);
    res.json({ round, availability: parseAvailability(a) || null });
  });

  r.put('/rounds/:id/mine', (req, res) => {
    if (req.user.role !== 'instructor') throw forbidden('Only instructors submit availability');
    const round = roundById.get(Number(req.params.id));
    if (!round) throw notFound('Availability round not found');
    if (round.status !== 'open') throw badRequest('This availability round is closed');
    res.json(saveAvailability(round, req.user.id, req.body || {}, req.user));
  });

  // Admins can record availability collected by phone or message.
  r.put('/rounds/:id/availability/:instructorId', (req, res) => {
    requireAdmin(req.user);
    const round = roundById.get(Number(req.params.id));
    if (!round) throw notFound('Availability round not found');
    const instructorId = Number(req.params.instructorId);
    if (!instructors().some((i) => i.id === instructorId)) throw badRequest('Instructor not found');
    res.json(saveAvailability(round, instructorId, req.body || {}, req.user));
  });

  // ---- assignments ---------------------------------------------------------
  const ASSIGN_SELECT = `
    SELECT a.*, c.name AS center_name, c.city AS center_city, u.name AS instructor_name, u.avatar_color AS instructor_color
    FROM center_assignments a JOIN centers c ON c.id = a.center_id JOIN users u ON u.id = a.instructor_id`;

  r.get('/assignments', (req, res) => {
    const where = ['1=1'];
    const params = [];
    if (req.query.center_id) where.push('a.center_id = ?'), params.push(Number(req.query.center_id));
    if (req.query.instructor_id) where.push('a.instructor_id = ?'), params.push(req.query.instructor_id === 'me' ? req.user.id : Number(req.query.instructor_id));
    if (req.query.day) where.push('a.day = ?'), params.push(req.query.day);
    const order = `CASE a.day ${WEEKDAYS.map((d, i) => `WHEN '${d}' THEN ${i}`).join(' ')} END, a.start_time`;
    res.json(db.prepare(`${ASSIGN_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}`).all(...params));
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
  function checkAssignment(a, force) {
    const center = centerById.get(a.center_id);
    if (!center) throw badRequest('Center not found');
    if (!center.active) throw badRequest('This center is inactive');
    const inst = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'instructor' AND active = 1").get(a.instructor_id);
    if (!inst) throw badRequest('Instructor not found');

    const sameDay = db.prepare(`${ASSIGN_SELECT} WHERE a.day = ? AND a.id != ?`).all(a.day, a.id || 0).filter((x) => timesOverlap(x, a) && datesOverlap(x, a));
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
      ? roundById.get(a.round_id)
      : db.prepare("SELECT * FROM availability_rounds ORDER BY status = 'open' DESC, id DESC LIMIT 1").get();
    if (!round) return;
    const sub = parseAvailability(db.prepare('SELECT * FROM availability WHERE round_id = ? AND instructor_id = ?').get(round.id, a.instructor_id));
    if (!sub) throw new HttpError(409, `${inst.name} has not submitted availability for "${round.title}"`, 'no_availability', { round: round.title });
    const covered = sub.slots.some((s) => s.day === a.day && s.start <= a.start_time && s.end >= a.end_time);
    if (!covered) {
      throw new HttpError(409, `${inst.name} is not available at that time`, 'outside_availability', {
        slots: sub.slots.filter((s) => s.day === a.day),
      });
    }
    if (sub.max_sessions != null) {
      const count = db.prepare('SELECT COUNT(*) AS n FROM center_assignments WHERE instructor_id = ? AND id != ?').get(a.instructor_id, a.id || 0).n;
      if (count >= sub.max_sessions) throw new HttpError(409, `${inst.name} asked for at most ${sub.max_sessions} sessions a week`, 'max_sessions', { max: sub.max_sessions });
    }
  }

  const DAY_LABEL = { sat: 'Saturday', sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };

  r.post('/assignments', (req, res) => {
    requireAdmin(req.user);
    const a = assignmentFields(req.body || {});
    checkAssignment(a, !!req.body?.force);
    const info = db
      .prepare(
        'INSERT INTO center_assignments (center_id, instructor_id, day, start_time, end_time, subject, round_id, starts_on, ends_on, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(a.center_id, a.instructor_id, a.day, a.start_time, a.end_time, a.subject || '', a.round_id || null, a.starts_on || null, a.ends_on || null, a.notes || '', req.user.id);
    const created = db.prepare(`${ASSIGN_SELECT} WHERE a.id = ?`).get(Number(info.lastInsertRowid));
    if (a.instructor_id !== req.user.id) {
      notify.run(
        a.instructor_id,
        'center_assigned',
        `${req.user.name} assigned you to ${created.center_name} on ${DAY_LABEL[a.day]} ${a.start_time}–${a.end_time}`,
        '/centers?tab=mine',
        JSON.stringify({ actor: req.user.name, center: created.center_name, day: a.day, start: a.start_time, end: a.end_time }),
      );
    }
    res.status(201).json(created);
  });

  r.patch('/assignments/:id', (req, res) => {
    requireAdmin(req.user);
    const existing = db.prepare('SELECT * FROM center_assignments WHERE id = ?').get(Number(req.params.id));
    if (!existing) throw notFound('Assignment not found');
    const a = assignmentFields(req.body || {}, existing);
    checkAssignment(a, !!req.body?.force);
    db.prepare(
      'UPDATE center_assignments SET center_id = ?, instructor_id = ?, day = ?, start_time = ?, end_time = ?, subject = ?, round_id = ?, starts_on = ?, ends_on = ?, notes = ? WHERE id = ?',
    ).run(a.center_id, a.instructor_id, a.day, a.start_time, a.end_time, a.subject || '', a.round_id || null, a.starts_on || null, a.ends_on || null, a.notes || '', existing.id);
    const updated = db.prepare(`${ASSIGN_SELECT} WHERE a.id = ?`).get(existing.id);
    const changed = ['center_id', 'instructor_id', 'day', 'start_time', 'end_time'].some((k) => existing[k] !== a[k]);
    if (changed && a.instructor_id !== req.user.id) {
      notify.run(
        a.instructor_id,
        'center_assigned',
        `${req.user.name} assigned you to ${updated.center_name} on ${DAY_LABEL[a.day]} ${a.start_time}–${a.end_time}`,
        '/centers?tab=mine',
        JSON.stringify({ actor: req.user.name, center: updated.center_name, day: a.day, start: a.start_time, end: a.end_time }),
      );
    }
    res.json(updated);
  });

  r.delete('/assignments/:id', (req, res) => {
    requireAdmin(req.user);
    const existing = db.prepare(`${ASSIGN_SELECT} WHERE a.id = ?`).get(Number(req.params.id));
    if (!existing) throw notFound('Assignment not found');
    db.prepare('DELETE FROM center_assignments WHERE id = ?').run(existing.id);
    if (existing.instructor_id !== req.user.id) {
      notify.run(
        existing.instructor_id,
        'center_unassigned',
        `${req.user.name} removed your session at ${existing.center_name} on ${DAY_LABEL[existing.day]} ${existing.start_time}`,
        '/centers?tab=mine',
        JSON.stringify({ actor: req.user.name, center: existing.center_name, day: existing.day, start: existing.start_time, end: existing.end_time }),
      );
    }
    res.status(204).end();
  });

  return r;
}
