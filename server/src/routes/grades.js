// Students and their marks: homework, exams and quizzes, at the centers and on
// the platform. The academic team (and leadership) enters marks; the content
// team and Customer Service can look them up. A student's code is the barcode
// on their book: scanning it finds them.
import { Router } from 'express';
import { badRequest, forbidden, idParam, notFound, oneOf, optionalDate, optionalId, requiredString } from '../http.js';
import { TRACKS, departmentOf, keys } from '../meta.js';
import { nowUtc } from '../time.js';

const KINDS = ['homework', 'exam', 'quiz'];
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const track = (v) => (v ? oneOf(String(v), keys(TRACKS), 'track') : '');

// Arabic or English track names in a sheet.
const TRACK_WORDS = { general: /^(general|عام|عامة|ثانوية عامة)$/i, azhar: /^(azhar|أزهر|ازهر)$/i, baccalaureate: /^(baccalaureate|bac|بكالوريا|البكالوريا)$/i };
const trackFrom = (v) => Object.keys(TRACK_WORDS).find((k) => TRACK_WORDS[k].test(String(v || '').trim())) || '';

export const canGrade = (user) => ['executive', 'operations', 'academic'].includes(departmentOf(user.role));
export const canSeeGrades = (user) => canGrade(user) || ['content', 'customer_service'].includes(departmentOf(user.role));

export default function gradeRoutes({ db }) {
  const r = Router();
  r.use((req, _res, next) => next(canSeeGrades(req.user) ? undefined : forbidden('Marks are for the academic team')));
  const mustGrade = (req) => {
    if (!canGrade(req.user)) throw forbidden('Only the academic team enters marks');
  };

  // Students an assessment is for: its group, track and center (blank means any).
  const ROSTER = `s.active = 1 AND (a.group_name = '' OR s.group_name = a.group_name) AND (a.track = '' OR s.track = a.track)
    AND (a.center_id IS NULL OR s.center_id = a.center_id)`;

  function studentFields(b) {
    return {
      name: requiredString(b.name, 'name', 200),
      code: text(b.code, 60) || null,
      phone: text(b.phone, 40),
      parent_phone: text(b.parent_phone, 40),
      track: track(b.track),
      group_name: text(b.group_name, 100),
      center_id: optionalId(b.center_id, 'center_id') ?? null,
    };
  }

  // ---- students ------------------------------------------------------------
  r.get('/students', async (req, res) => {
    const q = req.query;
    const where = ['s.active = 1'];
    const params = [];
    if (q.q) {
      where.push('(s.name ILIKE ? OR s.code = ? OR s.phone LIKE ?)');
      params.push(`%${q.q}%`, String(q.q), `%${q.q}%`);
    }
    if (q.group) (where.push('s.group_name = ?'), params.push(String(q.group)));
    if (q.track) (where.push('s.track = ?'), params.push(String(q.track)));
    const rows = await db.all(
      `SELECT s.*, c.name AS center_name,
         (SELECT ROUND(AVG(m.mark / a.max_mark * 100)) FROM marks m JOIN assessments a ON a.id = m.assessment_id WHERE m.student_id = s.id AND m.mark IS NOT NULL) AS average
       FROM students s LEFT JOIN centers c ON c.id = s.center_id WHERE ${where.join(' AND ')} ORDER BY s.name LIMIT 1000`,
      params,
    );
    const groups = (await db.all("SELECT DISTINCT group_name FROM students WHERE active = 1 AND group_name <> '' ORDER BY 1")).map((g) => g.group_name);
    res.json({ students: rows, groups });
  });

  // The barcode on a student's book.
  r.get('/lookup', async (req, res) => {
    const s = await db.get('SELECT * FROM students WHERE code = ? AND active = 1', [text(req.query.code, 60)]);
    if (!s) throw notFound('No student with that code');
    res.json(s);
  });

  r.post('/students', async (req, res) => {
    mustGrade(req);
    const f = studentFields(req.body || {});
    if (f.code && (await db.get('SELECT 1 FROM students WHERE code = ?', [f.code]))) throw badRequest('Another student already has that code');
    const s = await db.get(
      'INSERT INTO students (name, code, phone, parent_phone, track, group_name, center_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
      [f.name, f.code, f.phone, f.parent_phone, f.track, f.group_name, f.center_id],
    );
    res.status(201).json(s);
  });

  // A sheet of students; rows whose code is already taken are skipped.
  r.post('/students/import', async (req, res) => {
    mustGrade(req);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 5000) : [];
    const clean = rows
      .map((x) => ({
        name: text(x?.name, 200),
        code: text(x?.code, 60) || null,
        phone: text(x?.phone, 40),
        parent_phone: text(x?.parent_phone, 40),
        track: keys(TRACKS).includes(x?.track) ? x.track : trackFrom(x?.track),
        group_name: text(x?.group_name, 100),
      }))
      .filter((x) => x.name);
    if (!clean.length) throw badRequest('No students with a name in the sheet');
    const added = await db.tx(async (tx) => {
      const out = await tx.all(
        `INSERT INTO students (name, code, phone, parent_phone, track, group_name)
         SELECT * FROM unnest(?::text[], ?::text[], ?::text[], ?::text[], ?::text[], ?::text[]) ON CONFLICT (code) DO NOTHING RETURNING id`,
        ['name', 'code', 'phone', 'parent_phone', 'track', 'group_name'].map((k) => clean.map((x) => x[k])),
      );
      return out.length;
    });
    res.status(201).json({ added, skipped: clean.length - added });
  });

  r.patch('/students/:id', async (req, res) => {
    mustGrade(req);
    const s = await db.get('SELECT * FROM students WHERE id = ?', [idParam(req.params.id)]);
    if (!s) throw notFound('Student not found');
    const f = studentFields({ ...s, ...req.body });
    if (f.code && f.code !== s.code && (await db.get('SELECT 1 FROM students WHERE code = ?', [f.code]))) throw badRequest('Another student already has that code');
    const active = req.body?.active === undefined ? s.active : req.body.active ? 1 : 0;
    res.json(
      await db.get(
        'UPDATE students SET name = ?, code = ?, phone = ?, parent_phone = ?, track = ?, group_name = ?, center_id = ?, active = ? WHERE id = ? RETURNING *',
        [f.name, f.code, f.phone, f.parent_phone, f.track, f.group_name, f.center_id, active, s.id],
      ),
    );
  });

  // A student's report: every mark, with their average per kind.
  r.get('/students/:id', async (req, res) => {
    const s = await db.get('SELECT s.*, c.name AS center_name FROM students s LEFT JOIN centers c ON c.id = s.center_id WHERE s.id = ?', [idParam(req.params.id)]);
    if (!s) throw notFound('Student not found');
    const marks = await db.all(
      `SELECT a.id, a.title, a.kind, a.held_on, a.max_mark, m.mark, m.absent, m.note
       FROM assessments a JOIN students s ON s.id = ? LEFT JOIN marks m ON m.assessment_id = a.id AND m.student_id = s.id
       WHERE m.student_id IS NOT NULL OR (${ROSTER}) ORDER BY a.held_on DESC NULLS LAST, a.id DESC`,
      [s.id],
    );
    res.json({ ...s, marks });
  });

  // ---- assessments -----------------------------------------------------------
  r.get('/assessments', async (_req, res) => {
    res.json(
      await db.all(
        `SELECT a.*, u.name AS created_by_name, c.name AS center_name,
           (SELECT COUNT(*) FROM students s WHERE ${ROSTER})::int AS roster,
           (SELECT COUNT(*) FROM marks m WHERE m.assessment_id = a.id AND (m.mark IS NOT NULL OR m.absent = 1))::int AS graded,
           (SELECT ROUND(AVG(m.mark)::numeric, 1) FROM marks m WHERE m.assessment_id = a.id AND m.mark IS NOT NULL) AS average
         FROM assessments a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN centers c ON c.id = a.center_id
         ORDER BY a.held_on DESC NULLS LAST, a.id DESC LIMIT 300`,
      ),
    );
  });

  r.post('/assessments', async (req, res) => {
    mustGrade(req);
    const b = req.body || {};
    const max = Number(b.max_mark);
    if (!Number.isFinite(max) || max <= 0 || max > 1000) throw badRequest('Full mark must be a number above 0');
    const a = await db.get(
      `INSERT INTO assessments (title, kind, track, group_name, center_id, held_on, max_mark, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [requiredString(b.title, 'title', 200), oneOf(b.kind || 'homework', KINDS, 'kind'), track(b.track), text(b.group_name, 100), optionalId(b.center_id, 'center_id') ?? null, optionalDate(b.held_on, 'held_on') ?? null, max, req.user.id],
    );
    res.status(201).json(a);
  });

  // The assessment with its roster: every student it is for, and their mark.
  r.get('/assessments/:id', async (req, res) => {
    const a = await db.get('SELECT a.*, c.name AS center_name FROM assessments a LEFT JOIN centers c ON c.id = a.center_id WHERE a.id = ?', [idParam(req.params.id)]);
    if (!a) throw notFound('Not found');
    const students = await db.all(
      `SELECT s.id, s.name, s.code, s.group_name, s.track, m.mark, m.absent, m.note, g.name AS graded_by_name
       FROM assessments a JOIN students s ON (${ROSTER}) OR EXISTS (SELECT 1 FROM marks x WHERE x.assessment_id = a.id AND x.student_id = s.id)
       LEFT JOIN marks m ON m.assessment_id = a.id AND m.student_id = s.id LEFT JOIN users g ON g.id = m.graded_by
       WHERE a.id = ? ORDER BY s.name`,
      [a.id],
    );
    res.json({ ...a, students });
  });

  // One student's mark (sent as soon as it is typed or scanned). A blank mark clears it.
  r.put('/assessments/:id/marks/:studentId', async (req, res) => {
    mustGrade(req);
    const a = await db.get('SELECT * FROM assessments WHERE id = ?', [idParam(req.params.id)]);
    if (!a) throw notFound('Not found');
    const student = await db.get('SELECT id FROM students WHERE id = ?', [idParam(req.params.studentId)]);
    if (!student) throw notFound('Student not found');
    const b = req.body || {};
    const absent = b.absent ? 1 : 0;
    const mark = absent || b.mark === '' || b.mark == null ? null : Number(b.mark);
    if (mark != null && (!Number.isFinite(mark) || mark < 0 || mark > a.max_mark)) throw badRequest(`The mark must be from 0 to ${a.max_mark}`);
    if (mark == null && !absent && !text(b.note, 300)) {
      await db.run('DELETE FROM marks WHERE assessment_id = ? AND student_id = ?', [a.id, student.id]);
      return res.json({ student_id: student.id, mark: null, absent: 0 });
    }
    res.json(
      await db.get(
        `INSERT INTO marks (assessment_id, student_id, mark, absent, note, graded_by, graded_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (assessment_id, student_id) DO UPDATE SET mark = EXCLUDED.mark, absent = EXCLUDED.absent, note = EXCLUDED.note,
           graded_by = EXCLUDED.graded_by, graded_at = EXCLUDED.graded_at RETURNING *`,
        [a.id, student.id, mark, absent, text(b.note, 300), req.user.id, nowUtc()],
      ),
    );
  });

  r.delete('/assessments/:id', async (req, res) => {
    mustGrade(req);
    const a = await db.get('SELECT * FROM assessments WHERE id = ?', [idParam(req.params.id)]);
    if (!a) throw notFound('Not found');
    await db.run('DELETE FROM assessments WHERE id = ?', [a.id]);
    res.status(204).end();
  });

  return r;
}
