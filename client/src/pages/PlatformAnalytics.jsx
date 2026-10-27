import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { readSpreadsheet } from '../sheet.js';
import { Empty, Modal, Progress, Spinner, formatDate } from '../components/ui.jsx';

// The platform's own numbers (users, sessions, progress) live in the LMS: the
// Product Owner types the week in or imports a sheet, and uploads each course's
// progress export. Students who are behind go to Customer Service as a call list.

const FIELDS = ['total_users', 'new_users', 'active_users', 'sessions', 'avg_session_minutes', 'lessons_completed', 'avg_progress', 'exam_attempts'];
const TILES = [
  ['total_users', 'users'],
  ['active_users', 'team'],
  ['new_users', 'plus'],
  ['sessions', 'eye'],
  ['avg_session_minutes', 'clock'],
  ['avg_progress', 'progress'],
];

// Sheet headers in English or Arabic → the fields above.
const STAT_COLUMNS = {
  week: [/week|date|أسبوع|الاسبوع|الأسبوع|تاريخ/i],
  total_users: [/total|all users|إجمالي|اجمالي|كل المستخدمين/i],
  new_users: [/new|جديد|جدد/i],
  active_users: [/active|نشط/i],
  sessions: [/session|جلسات|جلسة/i],
  avg_session_minutes: [/minute|duration|time|دقائق|دقيقة|مدة/i],
  lessons_completed: [/lesson|دروس|درس/i],
  avg_progress: [/progress|تقدم|إنجاز/i],
  exam_attempts: [/exam|attempt|امتحان|امتحانات/i],
};
const PROGRESS_COLUMNS = {
  name: [/name|اسم|الطالب/i],
  code: [/code|id|كود|رقم الطالب/i],
  phone: [/phone|mobile|موبايل|تليفون|هاتف|whats/i],
  progress: [/progress|percent|%|تقدم|نسبة/i],
  lessons_done: [/completed|done|watched|منته|خلص|شاهد/i],
  lessons_total: [/total|all lessons|إجمالي|اجمالي|عدد الدروس/i],
  last_seen: [/last|seen|login|activity|آخر|اخر/i],
};

// Each field takes the first column that matches and isn't already taken.
function mapColumns(columns, patterns) {
  const taken = new Set();
  const map = {};
  for (const [k, res] of Object.entries(patterns)) {
    map[k] = columns.find((c) => !taken.has(c) && res.some((re) => re.test(c))) || '';
    if (map[k]) taken.add(map[k]);
  }
  return map;
}
const pickRows = (sheet, map) => sheet.rows.map((r) => Object.fromEntries(Object.entries(map).map(([k, c]) => [k, c ? r[c] : ''])));

export const canEditPlatform = (meta, user) => ['product', 'executive', 'operations'].includes(meta.roles[user.role]?.department);

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 }));

export default function Analytics() {
  const { meta, user, t, version } = useApp();
  const editable = canEditPlatform(meta, user);
  const [stats, setStats] = useState(null);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    api.get('/platform/stats', { weeks: 12 }).then(setStats);
  }, [version]);

  if (!stats) return <Spinner />;
  const latest = stats.weeks.at(-1);
  const before = stats.weeks.at(-2);
  const max = Math.max(1, ...stats.weeks.map((w) => w.active_users || 0));

  return (
    <div className="analytics">
      <section className="panel">
        <div className="panel-head">
          <h2>
            {t('analytics.usage')}
            {latest && <span className="muted sm"> · {t('platform.week', { date: formatDate(latest.week) })}</span>}
          </h2>
          {editable && (
            <div className="row gap">
              <button className="btn primary" onClick={() => setEditing({ date: stats.this_week, ...weekValues(stats.weeks.find((w) => w.week === stats.this_week)) })}>
                <Icon name="note" size={15} /> {t('analytics.enterWeek')}
              </button>
              <StatsImport />
            </div>
          )}
        </div>
        {!latest ? (
          <Empty icon="reports">{t('analytics.noStats')}</Empty>
        ) : (
          <>
            <div className="stats">
              {TILES.map(([k, icon]) => (
                <Tile key={k} icon={icon} label={t(`analytics.${k}`)} value={latest[k]} previous={before?.[k]} percent={k === 'avg_progress'} />
              ))}
            </div>
            <h3 className="analytics-sub">{t('analytics.trend')}</h3>
            <div className="trend" role="img" aria-label={t('analytics.trend')}>
              {stats.weeks.map((w) => (
                <div key={w.week} className="trend-bar" title={`${formatDate(w.week)}: ${fmt(w.active_users)}`}>
                  <span className="trend-value">{fmt(w.active_users)}</span>
                  <span className="trend-fill" style={{ height: `${((w.active_users || 0) / max) * 100}%` }} />
                  <span className="trend-label">{formatDate(w.week).replace(/,? \d{4}$/, '')}</span>
                </div>
              ))}
            </div>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('analytics.week')}</th>
                    {FIELDS.map((f) => (
                      <th key={f}>{t(`analytics.${f}`)}</th>
                    ))}
                    <th>{t('analytics.note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...stats.weeks].reverse().map((w) => (
                    <tr key={w.week} className={editable ? 'clickable' : ''} onClick={() => editable && setEditing({ date: w.week, ...weekValues(w) })}>
                      <td>{formatDate(w.week)}</td>
                      {FIELDS.map((f) => (
                        <td key={f}>{fmt(w[f])}{f === 'avg_progress' && w[f] != null ? '%' : ''}</td>
                      ))}
                      <td className="muted sm">{w.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      <StudentProgress editable={editable} />
      {editing && <WeekForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const weekValues = (w) => Object.fromEntries([...FIELDS, 'note'].map((f) => [f, w?.[f] ?? '']));

function Tile({ icon, label, value, previous, percent }) {
  const change = value != null && previous ? Math.round(((value - previous) / previous) * 100) : null;
  return (
    <div className="stat">
      <div className="stat-value">
        {fmt(value)}
        {percent && value != null ? '%' : ''}
        {change != null && change !== 0 && <span className={`trend-change ${change > 0 ? 'up' : 'down'}`}>{change > 0 ? `+${change}` : change}%</span>}
      </div>
      <div className="stat-label">
        <span className="stat-icon">
          <Icon name={icon} size={15} />
        </span>
        {label}
      </div>
    </div>
  );
}

function WeekForm({ initial, onClose }) {
  const { t, notify, refresh } = useApp();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { date, ...values } = form;
      await api.put(`/platform/stats/${date}`, values);
      notify(t('analytics.saved'), 'success');
      refresh();
      onClose();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={t('analytics.enterWeek')} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <p className="muted">{t('analytics.enterIntro')}</p>
        <div className="grid-3">
          <label>
            {t('analytics.week')}
            <input type="date" value={form.date} onChange={set('date')} required />
          </label>
          {FIELDS.map((f) => (
            <label key={f}>
              {t(`analytics.${f}`)}
              <input type="number" min="0" step="any" inputMode="decimal" value={form[f]} onChange={set(f)} />
            </label>
          ))}
        </div>
        <label>
          {t('analytics.note')}
          <input value={form.note} onChange={set('note')} maxLength={300} placeholder={t('analytics.notePh')} />
        </label>
        <div className="row gap end">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={saving}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function StatsImport() {
  const { t, notify, refresh } = useApp();
  const onFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const sheet = await readSpreadsheet(file);
      const map = mapColumns(sheet.columns, STAT_COLUMNS);
      if (!map.week) throw new Error(t('analytics.noWeekColumn'));
      const res = await api.post('/platform/stats/import', { rows: pickRows(sheet, map) });
      notify(t('analytics.importedWeeks', { n: res.weeks }), 'success');
      refresh();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  return (
    <label className="btn file-pick" title={t('analytics.importWeeksHint')}>
      <Icon name="upload" size={15} /> {t('analytics.importWeeks')}
      <input type="file" hidden accept=".xlsx,.csv,text/csv" onChange={onFile} />
    </label>
  );
}

function StudentProgress({ editable }) {
  const { t, version, notify, refresh } = useApp();
  const [filters, setFilters] = useState({ course: '', below: '', inactive: '' });
  const [data, setData] = useState(null);
  const [importing, setImporting] = useState(false);
  const [sending, setSending] = useState(false);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    const timer = setTimeout(() => api.get('/platform/progress', filters).then(setData), 200);
    return () => clearTimeout(timer);
  }, [filters, version]);

  const sendToCs = async () => {
    if (!confirm(t('analytics.sendConfirm', { n: data.students.filter((s) => s.phone).length }))) return;
    setSending(true);
    try {
      const res = await api.post('/platform/progress/call-list', filters);
      notify(t('analytics.sent', { n: res.calls }), 'success');
      refresh();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const filtered = filters.below !== '' || filters.inactive !== '';
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('analytics.progress')}</h2>
        {editable && (
          <button className="btn" onClick={() => setImporting(true)}>
            <Icon name="upload" size={15} /> {t('analytics.importProgress')}
          </button>
        )}
      </div>
      {!data ? (
        <Spinner />
      ) : !data.courses.length ? (
        <Empty icon="progress">{t('analytics.noProgress')}</Empty>
      ) : (
        <>
          <div className="course-cards">
            {data.courses.map((c) => (
              <button key={c.course} className={`course-card ${filters.course === c.course ? 'active' : ''}`} onClick={() => setFilters((f) => ({ ...f, course: f.course === c.course ? '' : c.course }))}>
                <strong>{c.course}</strong>
                <span className="muted sm">
                  {t('analytics.students', { n: c.students })} · {t('analytics.away', { n: c.away_7 })}
                </span>
                <Progress value={c.avg_progress ?? 0} total={100} />
                <span className="sm">
                  {t('analytics.avgProgress', { n: c.avg_progress ?? '—' })}
                  {c.imported_at && <span className="muted"> · {t('analytics.updated', { date: formatDate(c.imported_at.slice(0, 10)) })}</span>}
                </span>
              </button>
            ))}
          </div>
          <div className="filters">
            <select value={filters.course} onChange={set('course')}>
              <option value="">{t('analytics.allCourses')}</option>
              {data.courses.map((c) => (
                <option key={c.course} value={c.course}>
                  {c.course}
                </option>
              ))}
            </select>
            <select value={filters.below} onChange={set('below')}>
              <option value="">{t('analytics.anyProgress')}</option>
              {[25, 50, 75].map((n) => (
                <option key={n} value={n}>
                  {t('analytics.below', { n })}
                </option>
              ))}
            </select>
            <select value={filters.inactive} onChange={set('inactive')}>
              <option value="">{t('analytics.anyActivity')}</option>
              {[3, 7, 14, 30].map((n) => (
                <option key={n} value={n}>
                  {t('analytics.inactive', { n })}
                </option>
              ))}
            </select>
            <span className="muted sm">{t('analytics.matching', { n: data.total })}</span>
            {editable && filtered && data.total > 0 && (
              <button className="btn primary" onClick={sendToCs} disabled={sending}>
                <Icon name="calls" size={15} /> {t('analytics.sendToCs')}
              </button>
            )}
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('grades.student')}</th>
                  <th>{t('grades.code')}</th>
                  <th>{t('grades.phone')}</th>
                  <th>{t('analytics.course')}</th>
                  <th>{t('analytics.avg_progress')}</th>
                  <th>{t('analytics.lastSeen')}</th>
                </tr>
              </thead>
              <tbody>
                {data.students.slice(0, 300).map((s) => (
                  <tr key={s.id}>
                    <td>{s.student_name}</td>
                    <td className="muted">{s.student_code}</td>
                    <td dir="ltr">{s.phone}</td>
                    <td>{s.course}</td>
                    <td>
                      <span className={(s.progress ?? 0) < 50 ? 'text-danger' : ''}>{s.progress != null ? `${Math.round(s.progress)}%` : '—'}</span>
                      {s.lessons_total ? <span className="muted sm"> · {s.lessons_done ?? 0}/{s.lessons_total}</span> : null}
                    </td>
                    <td className={s.days_away == null || s.days_away >= 7 ? 'text-danger' : ''}>
                      {s.last_seen ? `${formatDate(s.last_seen)} · ${t('analytics.daysAgo', { n: s.days_away })}` : t('analytics.never')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total > 300 && <p className="muted sm">{t('analytics.showing', { n: 300, total: data.total })}</p>}
        </>
      )}
      {importing && <ProgressImport courses={data?.courses || []} onClose={() => setImporting(false)} />}
    </section>
  );
}

function ProgressImport({ courses, onClose }) {
  const { t, notify, refresh } = useApp();
  const [course, setCourse] = useState('');
  const [sheet, setSheet] = useState(null);
  const [map, setMap] = useState(null);
  const [saving, setSaving] = useState(false);

  const onFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = await readSpreadsheet(file);
      setSheet(parsed);
      setMap(mapColumns(parsed.columns, PROGRESS_COLUMNS));
      if (!course) setCourse(file.name.replace(/\.(xlsx|csv|txt)$/i, ''));
    } catch (err) {
      notify(err.message || t('upload.badFile'), 'error');
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post('/platform/progress/import', { course, rows: pickRows(sheet, map) });
      notify(t('analytics.importedStudents', { n: res.students, course: res.course }), 'success');
      refresh();
      onClose();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('analytics.importProgress')} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <p className="muted">{t('analytics.importIntro')}</p>
        <div className="grid-2">
          <label>
            {t('analytics.course')}
            <input list="platform-courses" value={course} onChange={(e) => setCourse(e.target.value)} required placeholder={t('analytics.coursePh')} />
            <datalist id="platform-courses">
              {courses.map((c) => (
                <option key={c.course} value={c.course} />
              ))}
            </datalist>
          </label>
          <label>
            {t('upload.file')}
            <input type="file" accept=".xlsx,.csv,text/csv" onChange={onFile} />
          </label>
        </div>
        {sheet && (
          <div className="grid-3">
            {Object.keys(PROGRESS_COLUMNS).map((k) => (
              <label key={k}>
                {t(`analytics.col.${k}`)}
                <select value={map[k]} onChange={(e) => setMap((m) => ({ ...m, [k]: e.target.value }))}>
                  <option value="">—</option>
                  {sheet.columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
        {sheet && <p className="muted sm">{t('analytics.replaceWarn', { n: sheet.rows.length })}</p>}
        <div className="row gap end">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!sheet || !map?.name || !course || saving}>
            {t('analytics.import', { n: sheet?.rows.length ?? 0 })}
          </button>
        </div>
      </form>
    </Modal>
  );
}

