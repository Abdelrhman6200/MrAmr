// The online platform's numbers and students' progress, owned by the Product
// Owner. The platform itself (the LMS) is elsewhere: its weekly numbers are typed
// in or imported, and its progress export is uploaded per course. Students who
// are behind or haven't been seen can be sent to Customer Service as a call list.
import { Router } from 'express';
import { badRequest, forbidden, requiredString } from '../http.js';
import { departmentOf } from '../meta.js';
import { DAY, localDate, nowUtc } from '../time.js';
import { weekStart } from '../weekly.js';
import { audit } from '../audit.js';

const STAT_FIELDS = ['total_users', 'new_users', 'active_users', 'sessions', 'avg_session_minutes', 'lessons_completed', 'avg_progress', 'exam_attempts'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Who sees the numbers, and who changes them.
const canSee = (user) => ['product', 'executive', 'operations', 'customer_service', 'academic', 'content'].includes(departmentOf(user.role));
const canEdit = (user) => ['product', 'executive', 'operations'].includes(departmentOf(user.role));

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[,%\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// "2026-10-20", "20/10/2026" or a spreadsheet date: as YYYY-MM-DD.
function toDate(v) {
  const s = String(v ?? '').trim();
  if (DATE_RE.test(s.slice(0, 10))) return s.slice(0, 10);
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

const daysAgo = (date, today) => Math.round((Date.parse(today) - Date.parse(date)) / DAY);

export default function platformRoutes({ db }) {
  const r = Router();
  r.use((req, _res, next) => next(canSee(req.user) ? undefined : forbidden('The platform numbers are for the product team')));
  const mustEdit = (req) => {
    if (!canEdit(req.user)) throw forbidden('Only the product team changes the platform numbers');
  };

  async function saveWeek(q, week, b, userId) {
    const values = STAT_FIELDS.map((f) => num(b[f]));
    await q.run(
      `INSERT INTO platform_stats (week, ${STAT_FIELDS.join(', ')}, note, updated_by, updated_at) VALUES (?, ${STAT_FIELDS.map(() => '?').join(', ')}, ?, ?, ?)
       ON CONFLICT (week) DO UPDATE SET ${STAT_FIELDS.map((f) => `${f} = EXCLUDED.${f}`).join(', ')}, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      [week, ...values, String(b.note || '').slice(0, 300), userId, nowUtc()],
    );
  }

  // ---- weekly numbers --------------------------------------------------------
  r.get('/stats', async (req, res) => {
    const weeks = Math.min(Math.max(Number(req.query.weeks) || 12, 1), 104);
    const rows = await db.all('SELECT s.*, u.name AS updated_by_name FROM platform_stats s LEFT JOIN users u ON u.id = s.updated_by ORDER BY week DESC LIMIT ?', [weeks]);
    res.json({ this_week: weekStart(), weeks: rows.reverse() });
  });

  // One week's numbers (any day of the week; it is filed under its Saturday).
  r.put('/stats/:date', async (req, res) => {
    mustEdit(req);
    const date = toDate(req.params.date);
    if (!date) throw badRequest('Pick the week');
    const week = weekStart(date);
    await db.tx(async (tx) => {
      await saveWeek(tx, week, req.body || {}, req.user.id);
      await audit(tx, req.user, 'updated', 'platform_stats', null, { week });
    });
    res.json(await db.get('SELECT * FROM platform_stats WHERE week = ?', [week]));
  });

  // Many weeks at once, from a sheet (a "week" or "date" column, then the numbers).
  r.post('/stats/import', async (req, res) => {
    mustEdit(req);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 520) : [];
    const valid = rows.map((x) => ({ ...x, date: toDate(x?.week) })).filter((x) => x.date);
    if (!valid.length) throw badRequest('No rows with a week or date');
    await db.tx(async (tx) => {
      for (const x of valid) await saveWeek(tx, weekStart(x.date), x, req.user.id);
      await audit(tx, req.user, 'imported', 'platform_stats', null, { weeks: valid.length });
    });
    res.status(201).json({ weeks: valid.length, skipped: rows.length - valid.length });
  });

  // ---- students' progress ------------------------------------------------------
  // Filters: course, below (progress under N%), inactive (not seen for N days).
  r.get('/progress', async (req, res) => {
    const today = localDate();
    const rows = await db.all('SELECT * FROM platform_progress ORDER BY course, progress NULLS FIRST, student_name');
    const below = num(req.query.below);
    const inactive = num(req.query.inactive);
    const pick = rows
      .map((p) => ({ ...p, days_away: p.last_seen ? daysAgo(p.last_seen, today) : null }))
      .filter((p) => !req.query.course || p.course === req.query.course)
      .filter((p) => below == null || (p.progress ?? 0) < below)
      .filter((p) => inactive == null || p.days_away == null || p.days_away >= inactive);
    const courses = [...new Set(rows.map((p) => p.course))].map((course) => {
      const list = rows.filter((p) => p.course === course);
      const withProgress = list.filter((p) => p.progress != null);
      return {
        course,
        students: list.length,
        avg_progress: withProgress.length ? Math.round(withProgress.reduce((n, p) => n + p.progress, 0) / withProgress.length) : null,
        away_7: list.filter((p) => !p.last_seen || daysAgo(p.last_seen, today) >= 7).length,
        imported_at: list[0]?.imported_at,
      };
    });
    res.json({ courses, students: pick.slice(0, 2000), total: pick.length });
  });

  // A course's progress export; replaces what was there for that course.
  r.post('/progress/import', async (req, res) => {
    mustEdit(req);
    const course = requiredString(req.body?.course, 'course', 120);
    const rows = (Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 20000) : [])
      .map((x) => ({
        name: String(x?.name ?? '').trim().slice(0, 200),
        code: String(x?.code ?? '').trim().slice(0, 60),
        phone: String(x?.phone ?? '').trim().slice(0, 40),
        progress: num(x?.progress),
        lessons_done: num(x?.lessons_done),
        lessons_total: num(x?.lessons_total),
        last_seen: toDate(x?.last_seen),
      }))
      .filter((x) => x.name);
    if (!rows.length) throw badRequest('No students with a name in the sheet');
    // A sheet whose percentages are all 0–1 holds fractions.
    const fractions = rows.every((y) => y.progress == null || y.progress <= 1);
    for (const x of rows) {
      // Progress from lessons when the sheet has no percentage.
      if (x.progress == null && x.lessons_total) x.progress = Math.round(((x.lessons_done || 0) / x.lessons_total) * 100);
      else if (x.progress != null && fractions) x.progress = Math.round(x.progress * 100);
      if (x.progress != null) x.progress = Math.min(x.progress, 100);
    }
    await db.tx(async (tx) => {
      await tx.run('DELETE FROM platform_progress WHERE course = ?', [course]);
      await tx.run(
        `INSERT INTO platform_progress (course, student_name, student_code, phone, progress, lessons_done, lessons_total, last_seen, imported_by)
         SELECT ?, * , ? FROM unnest(?::text[], ?::text[], ?::text[], ?::real[], ?::int[], ?::int[], ?::text[])`,
        [course, req.user.id, ...['name', 'code', 'phone', 'progress', 'lessons_done', 'lessons_total', 'last_seen'].map((k) => rows.map((x) => x[k]))],
      );
      await audit(tx, req.user, 'imported', 'platform_progress', null, { course, students: rows.length });
    });
    res.status(201).json({ course, students: rows.length });
  });

  // Students who are behind or away become a call list for Customer Service (who
  // split it between their agents), and the heads of Customer Service are told.
  r.post('/progress/call-list', async (req, res) => {
    mustEdit(req);
    const b = req.body || {};
    const today = localDate();
    const below = num(b.below);
    const inactive = num(b.inactive);
    if (below == null && inactive == null) throw badRequest('Choose who to call: below a progress, or away for some days');
    const rows = (await db.all('SELECT * FROM platform_progress WHERE (?::text IS NULL OR course = ?)', [b.course || null, b.course || null])).filter(
      (p) => p.phone && ((below != null && (p.progress ?? 0) < below) || (inactive != null && (!p.last_seen || daysAgo(p.last_seen, today) >= inactive))),
    );
    if (!rows.length) throw badRequest('No students with a phone number match');
    const name = requiredString(b.name || `${b.course || 'Platform'} — follow-up ${today}`, 'name', 200);
    const columns = ['Name', 'Phone', 'Code', 'Course', 'Progress', 'Last seen'];
    const list = await db.tx(async (tx) => {
      const l = await tx.get('INSERT INTO call_lists (name, description, source_filename, columns, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id', [
        name,
        String(b.description || '').slice(0, 500),
        'platform-progress',
        JSON.stringify(columns),
        req.user.id,
      ]);
      await tx.run(
        `INSERT INTO calls (list_id, name, phone, data) SELECT ?, n, p, d FROM unnest(?::text[], ?::text[], ?::text[]) AS x(n, p, d)`,
        [
          l.id,
          rows.map((p) => p.student_name),
          rows.map((p) => p.phone),
          rows.map((p) => JSON.stringify({ Name: p.student_name, Phone: p.phone, Code: p.student_code || '', Course: p.course, Progress: p.progress != null ? `${p.progress}%` : '', 'Last seen': p.last_seen || '' })),
        ],
      );
      const heads = await tx.all("SELECT id FROM users WHERE role IN ('cs_head', 'cs_team_lead') AND active = 1");
      for (const h of heads) {
        await tx.run("INSERT INTO notifications (user_id, type, message, link, params) VALUES (?, 'calls_assigned', ?, ?, ?)", [
          h.id,
          `${req.user.name} sent ${rows.length} call(s) from "${name}"`,
          `/calls?list=${l.id}`,
          JSON.stringify({ actor: req.user.name, count: rows.length, list: name }),
        ]);
      }
      await audit(tx, req.user, 'created', 'call_list', l.id, { name, calls: rows.length });
      return l;
    });
    res.status(201).json({ list_id: list.id, calls: rows.length });
  });

  return r;
}
