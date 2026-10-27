import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Empty, Modal, Spinner, TrackTag, formatDate, todayISO } from '../components/ui.jsx';
import { readSpreadsheet } from '../sheet.js';

const KINDS = ['homework', 'exam', 'quiz'];

// Who enters marks (the rest who see this page only look them up).
export const canGrade = (meta, user) => ['executive', 'operations', 'academic'].includes(meta.roles[user.role]?.department);
export const canSeeGrades = (meta, user) => canGrade(meta, user) || ['content', 'customer_service'].includes(meta.roles[user.role]?.department);

// Marks for homework, exams and quizzes. A barcode scanner types the student's
// code and Enter, so scanning a book jumps straight to that student's mark.
export default function Grades() {
  const { t } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'students' ? 'students' : 'assessments';
  const open = params.get('a');
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('grades.title')}</h1>
          <p className="muted">{t('grades.intro')}</p>
        </div>
        <div className="seg">
          <button className={tab === 'assessments' ? 'active' : ''} onClick={() => setParams({})}>
            {t('grades.assessments')}
          </button>
          <button className={tab === 'students' ? 'active' : ''} onClick={() => setParams({ tab: 'students' })}>
            {t('grades.students')}
          </button>
        </div>
      </div>
      {tab === 'students' ? <Students /> : open ? <MarkEntry id={open} onBack={() => setParams({})} /> : <Assessments onOpen={(id) => setParams({ a: id })} />}
    </div>
  );
}

function Assessments({ onOpen }) {
  const { meta, user, t, version, notify, trackLabel } = useApp();
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);
  const [groups, setGroups] = useState([]);
  useEffect(() => {
    api.get('/grades/assessments').then(setRows).catch(() => setRows([]));
    api.get('/grades/students').then((r) => setGroups(r.groups)).catch(() => {});
  }, [version]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    try {
      const a = await api.post('/grades/assessments', form);
      onOpen(a.id);
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <>
      {canGrade(meta, user) && !form && (
        <button className="btn primary grades-new" onClick={() => setForm({ title: '', kind: 'homework', max_mark: 10, held_on: todayISO(), group_name: '', track: '' })}>
          <Icon name="plus" size={16} /> {t('grades.newAssessment')}
        </button>
      )}
      {form && (
        <form className="panel form" onSubmit={save}>
          <div className="grid-3">
            <label>
              {t('form.title')}
              <input value={form.title} onChange={set('title')} placeholder={t('grades.titlePh')} required autoFocus />
            </label>
            <label>
              {t('grades.kind')}
              <select value={form.kind} onChange={set('kind')}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`grades.kind.${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('grades.fullMark')}
              <input type="number" min="1" step="0.5" value={form.max_mark} onChange={set('max_mark')} required />
            </label>
            <label>
              {t('grades.date')}
              <input type="date" value={form.held_on} onChange={set('held_on')} />
            </label>
            <label>
              {t('grades.group')}
              <input list="grade-groups" value={form.group_name} onChange={set('group_name')} placeholder={t('grades.anyGroup')} />
              <datalist id="grade-groups">
                {groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </label>
            <label>
              {t('form.track')}
              <select value={form.track} onChange={set('track')}>
                <option value="">{t('form.noTrack')}</option>
                {meta.tracks.map((x) => (
                  <option key={x.key} value={x.key}>
                    {trackLabel(x.key)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row gap">
            <button className="btn primary">{t('grades.startGrading')}</button>
            <button type="button" className="btn" onClick={() => setForm(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty icon="checklist">{t('grades.noAssessments')}</Empty>
      ) : (
        <section className="panel flush">
          <table className="table">
            <thead>
              <tr>
                <th>{t('form.title')}</th>
                <th>{t('grades.group')}</th>
                <th>{t('grades.date')}</th>
                <th>{t('grades.graded')}</th>
                <th>{t('grades.average')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => onOpen(a.id)}>
                  <td>
                    <div className="cell-title">{a.title}</div>
                    <div className="muted sm">
                      {t(`grades.kind.${a.kind}`)} · {t('grades.outOf', { n: a.max_mark })} <TrackTag track={a.track} />
                    </div>
                  </td>
                  <td>{a.group_name || t('grades.anyGroup')}</td>
                  <td>{a.held_on ? formatDate(a.held_on) : '—'}</td>
                  <td>
                    {a.graded}/{a.roster}
                  </td>
                  <td>{a.average != null ? `${a.average} / ${a.max_mark}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function MarkEntry({ id, onBack }) {
  const { meta, user, t, notify } = useApp();
  const [a, setA] = useState(null);
  const [scan, setScan] = useState('');
  const [saved, setSaved] = useState({});
  const inputs = useRef({});
  const scanRef = useRef(null);
  const editable = canGrade(meta, user);
  useEffect(() => {
    api.get(`/grades/assessments/${id}`).then(setA).catch((err) => notify(err.message, 'error'));
  }, [id]);
  if (!a) return <Spinner />;

  const update = (sid, patch) => setA((x) => ({ ...x, students: x.students.map((s) => (s.id === sid ? { ...s, ...patch } : s)) }));
  const save = async (s, patch) => {
    const next = { mark: s.mark ?? '', absent: !!s.absent, note: s.note || '', ...patch };
    try {
      await api.put(`/grades/assessments/${a.id}/marks/${s.id}`, next);
      update(s.id, { mark: next.absent || next.mark === '' ? null : Number(next.mark), absent: next.absent ? 1 : 0 });
      setSaved((x) => ({ ...x, [s.id]: true }));
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  // A scanned code (or typed name) jumps to that student's mark.
  const find = (e) => {
    e.preventDefault();
    const q = scan.trim().toLowerCase();
    if (!q) return;
    const s = a.students.find((x) => (x.code || '').toLowerCase() === q) || a.students.find((x) => x.name.toLowerCase().includes(q));
    if (!s) return notify(t('grades.notFound', { q: scan }), 'error');
    setScan('');
    inputs.current[s.id]?.focus();
    inputs.current[s.id]?.select();
  };
  const marked = a.students.filter((s) => s.mark != null);
  const avg = marked.length ? marked.reduce((n, s) => n + Number(s.mark), 0) / marked.length : null;

  return (
    <section className="panel mark-entry">
      <button className="link sm" onClick={onBack}>
        ← {t('grades.assessments')}
      </button>
      <h2>{a.title}</h2>
      <p className="muted sm">
        {t(`grades.kind.${a.kind}`)} · {t('grades.outOf', { n: a.max_mark })} · {a.group_name || t('grades.anyGroup')}
        {a.held_on && <> · {formatDate(a.held_on)}</>}
      </p>
      <div className="mark-stats">
        <span>{t('grades.gradedOf', { n: a.students.filter((s) => s.mark != null || s.absent).length, total: a.students.length })}</span>
        {avg != null && <span>{t('grades.avgIs', { n: avg.toFixed(1), max: a.max_mark })}</span>}
        {marked.length > 0 && <span>{t('grades.highest', { n: Math.max(...marked.map((s) => Number(s.mark))) })}</span>}
      </div>
      {editable && (
        <form className="scan" onSubmit={find}>
          <Icon name="search" size={16} />
          <input ref={scanRef} value={scan} onChange={(e) => setScan(e.target.value)} placeholder={t('grades.scanPh')} autoFocus />
        </form>
      )}
      {a.students.length === 0 ? (
        <Empty icon="team">{t('grades.noRoster')}</Empty>
      ) : (
        <table className="table marks">
          <thead>
            <tr>
              <th>{t('grades.student')}</th>
              <th>{t('grades.code')}</th>
              <th>{t('grades.mark')}</th>
              <th>{t('grades.absent')}</th>
            </tr>
          </thead>
          <tbody>
            {a.students.map((s) => (
              <tr key={s.id} className={saved[s.id] ? 'saved' : ''}>
                <td>{s.name}</td>
                <td className="muted">{s.code || '—'}</td>
                <td>
                  <input
                    ref={(el) => (inputs.current[s.id] = el)}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max={a.max_mark}
                    step="0.5"
                    className="mark-input"
                    value={s.mark ?? ''}
                    disabled={!editable || !!s.absent}
                    onChange={(e) => update(s.id, { mark: e.target.value === '' ? null : e.target.value })}
                    onBlur={(e) => save(s, { mark: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                        scanRef.current?.focus();
                      }
                    }}
                  />
                  {saved[s.id] && <Icon name="check" size={14} className="saved-tick" />}
                </td>
                <td>
                  <input type="checkbox" checked={!!s.absent} disabled={!editable} onChange={(e) => save(s, { absent: e.target.checked, mark: '' })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const STUDENT_COLUMNS = {
  name: [/name|اسم|الطالب/i],
  code: [/code|barcode|كود|باركود|رقم الطالب|id/i],
  phone: [/^phone|mobile|موبايل|تليفون|هاتف(?!.*ولي)/i],
  parent_phone: [/parent|guardian|ولي|الأب|الام|الأم/i],
  group_name: [/group|class|مجموعة|المجموعة|فصل/i],
  track: [/track|مسار|نظام/i],
};

function Students() {
  const { meta, user, t, version, refresh, notify, trackLabel } = useApp();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [form, setForm] = useState(null);
  const [report, setReport] = useState(null);
  const editable = canGrade(meta, user);
  useEffect(() => {
    const timer = setTimeout(() => api.get('/grades/students', { q, group }).then(setData).catch(() => setData({ students: [], groups: [] })), 150);
    return () => clearTimeout(timer);
  }, [q, group, version]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    try {
      await api.post('/grades/students', form);
      setForm(null);
      refresh();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const importSheet = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const sheet = await readSpreadsheet(file);
      const col = (k) => sheet.columns.find((c) => STUDENT_COLUMNS[k].some((re) => re.test(c)));
      const map = Object.fromEntries(Object.keys(STUDENT_COLUMNS).map((k) => [k, col(k)]));
      if (!map.name) throw new Error(t('grades.noNameColumn'));
      const rows = sheet.rows.map((r) => Object.fromEntries(Object.entries(map).map(([k, c]) => [k, c ? r[c] : ''])));
      const res = await api.post('/grades/students/import', { rows });
      notify(t('grades.imported', res), 'success');
      refresh();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <>
      <div className="filters">
        <input className="search" placeholder={t('grades.searchStudents')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">{t('grades.anyGroup')}</option>
          {data?.groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        {editable && (
          <>
            <button className="btn" onClick={() => setForm({ name: '', code: '', phone: '', parent_phone: '', group_name: group, track: '' })}>
              <Icon name="plus" size={15} /> {t('grades.addStudent')}
            </button>
            <label className="btn file-pick">
              <Icon name="upload" size={15} /> {t('grades.importSheet')}
              <input type="file" hidden accept=".xlsx,.csv,text/csv" onChange={importSheet} />
            </label>
          </>
        )}
      </div>
      {form && (
        <form className="panel form" onSubmit={save}>
          <div className="grid-3">
            <label>
              {t('grades.student')}
              <input value={form.name} onChange={set('name')} required autoFocus />
            </label>
            <label>
              {t('grades.code')}
              <input value={form.code} onChange={set('code')} placeholder={t('grades.codePh')} />
            </label>
            <label>
              {t('grades.group')}
              <input list="student-groups" value={form.group_name} onChange={set('group_name')} />
              <datalist id="student-groups">
                {data?.groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </label>
            <label>
              {t('grades.phone')}
              <input value={form.phone} onChange={set('phone')} />
            </label>
            <label>
              {t('grades.parentPhone')}
              <input value={form.parent_phone} onChange={set('parent_phone')} />
            </label>
            <label>
              {t('form.track')}
              <select value={form.track} onChange={set('track')}>
                <option value="">{t('form.noTrack')}</option>
                {meta.tracks.map((x) => (
                  <option key={x.key} value={x.key}>
                    {trackLabel(x.key)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row gap">
            <button className="btn primary">{t('common.save')}</button>
            <button type="button" className="btn" onClick={() => setForm(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
      {!data ? (
        <Spinner />
      ) : data.students.length === 0 ? (
        <Empty icon="team">{t('grades.noStudents')}</Empty>
      ) : (
        <section className="panel flush">
          <table className="table">
            <thead>
              <tr>
                <th>{t('grades.student')}</th>
                <th>{t('grades.code')}</th>
                <th>{t('grades.group')}</th>
                <th>{t('grades.parentPhone')}</th>
                <th>{t('grades.average')}</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => setReport(s.id)}>
                  <td>
                    {s.name} <TrackTag track={s.track} />
                  </td>
                  <td className="muted">{s.code || '—'}</td>
                  <td>{s.group_name || '—'}</td>
                  <td>{s.parent_phone || '—'}</td>
                  <td>{s.average != null ? `${s.average}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {report && <StudentReport id={report} onClose={() => setReport(null)} />}
    </>
  );
}

function StudentReport({ id, onClose }) {
  const { t } = useApp();
  const [s, setS] = useState(null);
  useEffect(() => {
    api.get(`/grades/students/${id}`).then(setS).catch(() => {});
  }, [id]);
  const pct = (m) => (m.mark != null ? Math.round((m.mark / m.max_mark) * 100) : null);
  const byKind = s ? KINDS.map((k) => [k, s.marks.filter((m) => m.kind === k && m.mark != null)]).filter(([, list]) => list.length) : [];
  return (
    <Modal title={s ? s.name : t('common.loading')} onClose={onClose} wide>
      {!s ? (
        <Spinner />
      ) : (
        <>
          <p className="muted">
            {[s.code && `${t('grades.code')}: ${s.code}`, s.group_name, s.parent_phone && `${t('grades.parentPhone')}: ${s.parent_phone}`].filter(Boolean).join(' · ')}
          </p>
          <div className="mark-stats">
            {byKind.map(([k, list]) => (
              <span key={k}>
                {t(`grades.kind.${k}`)}: {Math.round(list.reduce((n, m) => n + pct(m), 0) / list.length)}%
              </span>
            ))}
            <span>{t('grades.absences', { n: s.marks.filter((m) => m.absent).length })}</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>{t('form.title')}</th>
                <th>{t('grades.date')}</th>
                <th>{t('grades.mark')}</th>
              </tr>
            </thead>
            <tbody>
              {s.marks.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.title} <span className="muted sm">· {t(`grades.kind.${m.kind}`)}</span>
                  </td>
                  <td>{m.held_on ? formatDate(m.held_on) : '—'}</td>
                  <td>{m.absent ? <span className="pill status-blocked">{t('grades.absent')}</span> : m.mark != null ? `${m.mark} / ${m.max_mark} (${pct(m)}%)` : <span className="muted">{t('grades.notGraded')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}
