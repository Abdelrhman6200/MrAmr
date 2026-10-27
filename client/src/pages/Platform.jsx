import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { TaskTable } from '../components/TaskViews.jsx';
import Analytics from './PlatformAnalytics.jsx';
import { Avatar, Empty, Modal, Spinner, StatusPill, TrackPicker, TrackTag, UserSelect, formatDate, isOverdue, todayISO, useTaskDialog } from '../components/ui.jsx';

// The online platform in one place, one tab per kind of work. The schedule is
// the publishing timeline: content uploads and the exams that go live.
const TABS = [
  { key: 'schedule', types: ['content_upload', 'platform_exam'], icon: 'upload' },
  { key: 'exams', types: ['platform_exam', 'exam_results'], icon: 'note' },
  { key: 'forums', types: ['forum_moderation'], icon: 'comment' },
  { key: 'complaints', types: ['complaint'], icon: 'alert' },
  { key: 'issues', types: ['bug', 'feature'], icon: 'flag' },
  { key: 'analytics', types: [], icon: 'reports' },
];

const DAY = 864e5;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
// The Saturday that starts the week of `iso`.
const weekOf = (iso) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 1) % 7));

// Who sees the Platform page: the product team, leadership, and Customer Service (complaints).
export const canSeePlatform = (meta, user) => ['product', 'executive', 'operations', 'customer_service'].includes(meta.roles[user.role]?.department);

export default function Platform() {
  const { version, t } = useApp();
  const { create } = useTaskDialog();
  const [tab, setTab] = useState('schedule');
  const [tasks, setTasks] = useState(null);
  const [planning, setPlanning] = useState(false);
  const current = TABS.find((x) => x.key === tab);

  useEffect(() => {
    setTasks(null);
    if (current.types.length) api.get('/tasks', { type: current.types.join(',') }).then(setTasks);
  }, [tab, version]);

  const stats = useMemo(() => {
    if (!tasks) return null;
    const today = todayISO();
    const weekAgo = addDays(today, -7);
    const open = tasks.filter((x) => x.status !== 'done');
    return {
      open: open.length,
      late: open.filter(isOverdue).length,
      week: open.filter((x) => x.due_date && x.due_date >= today && x.due_date <= addDays(today, 7)).length,
      done: tasks.filter((x) => x.status === 'done' && (x.completed_at || '').slice(0, 10) >= weekAgo).length,
    };
  }, [tasks]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('platform.title')}</h1>
          <p className="muted">{t('platform.intro')}</p>
        </div>
        <div className="row gap">
          {tab === 'schedule' && (
            <button className="btn primary" onClick={() => setPlanning(true)}>
              <Icon name="calendar" size={16} /> {t('platform.plan')}
            </button>
          )}
          {current.types.length > 0 && (
            <button className="btn" onClick={() => create({ type: current.types[0] })}>
              <Icon name="plus" size={16} /> {t('platform.new')}
            </button>
          )}
        </div>
      </div>

      <div className="seg platform-tabs">
        {TABS.map((x) => (
          <button key={x.key} className={tab === x.key ? 'active' : ''} onClick={() => setTab(x.key)}>
            <Icon name={x.icon} size={15} /> {t(`platform.tab.${x.key}`)}
          </button>
        ))}
      </div>

      {tab === 'analytics' ? (
        <Analytics />
      ) : !tasks ? (
        <Spinner />
      ) : (
        <>
          <div className="stats">
            <Stat icon="tasks" label={t('platform.open')} value={stats.open} />
            <Stat icon="clock" label={t('platform.overdue')} value={stats.late} tone={stats.late ? 'danger' : ''} />
            <Stat icon="calendar" label={t('platform.thisWeek')} value={stats.week} tone="info" />
            <Stat icon="done" label={t('platform.doneWeek')} value={stats.done} tone="success" />
          </div>
          {tasks.length === 0 ? (
            <Empty icon={current.icon}>{t('platform.empty')}</Empty>
          ) : tab === 'schedule' ? (
            <Schedule tasks={tasks} />
          ) : (
            <section className="panel flush">
              <TaskTable tasks={tasks} />
            </section>
          )}
        </>
      )}
      {planning && <PlanUploads onClose={() => setPlanning(false)} />}
    </div>
  );
}

function Stat({ icon, label, value, tone }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">
        <span className="stat-icon">
          <Icon name={icon} size={15} />
        </span>
        {label}
      </div>
    </div>
  );
}

// Uploads by week, oldest first; finished weeks more than two weeks back are left out.
function Schedule({ tasks }) {
  const { t } = useApp();
  const { open } = useTaskDialog();
  const thisWeek = weekOf(todayISO());
  const weeks = new Map();
  for (const task of [...tasks].sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'))) {
    const week = task.due_date ? weekOf(task.due_date) : '';
    if (week && week < addDays(thisWeek, -14) && task.status === 'done') continue;
    weeks.set(week, [...(weeks.get(week) || []), task]);
  }
  return (
    <div className="schedule">
      {[...weeks].map(([week, list]) => (
        <section key={week} className={`panel schedule-week ${week === thisWeek ? 'current' : ''}`}>
          <h2>
            {week ? t('platform.week', { date: formatDate(week) }) : t('platform.noDate')}
            <span className="muted sm">
              {list.filter((x) => x.status === 'done').length}/{list.length} {t('platform.uploaded')}
            </span>
          </h2>
          <ul className="schedule-list">
            {list.map((task) => (
              <li key={task.id} className={`clickable ${isOverdue(task) ? 'late' : ''}`} onClick={() => open(task.id)}>
                <span className="schedule-date">{task.due_date ? formatDate(task.due_date) : '—'}</span>
                <span className="schedule-title">
                  {task.title}
                  {task.project_name && <span className="muted sm"> · {task.project_name}</span>}
                </span>
                <span className="row gap">
                  <TrackTag track={task.track} />
                  <StatusPill status={task.status} />
                  {task.assignee_name && <Avatar name={task.assignee_name} color={task.assignee_color} size={24} title={task.assignee_name} />}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// Turns a content plan (one item per line) into upload tasks spread over the weeks.
function PlanUploads({ onClose }) {
  const { user, users, t, typeLabel, notify, refresh } = useApp();
  const [projects, setProjects] = useState([]);
  const [assignable, setAssignable] = useState([]);
  const [form, setForm] = useState({ project_id: null, type: 'content_upload', assignee_id: user.id, reviewer_id: null, track: '', items: '', first: todayISO(), every: 7 });
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));

  useEffect(() => {
    api.get('/projects').then(setProjects).catch(() => {});
  }, []);
  useEffect(() => {
    api.get('/users/assignable', { project_id: form.project_id }).then(setAssignable).catch(() => {});
  }, [form.project_id]);

  const titles = form.items.split('\n').map((s) => s.trim()).filter(Boolean);
  const items = titles.map((title, i) => ({ title, due_date: form.first ? addDays(form.first, i * Number(form.every)) : null }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { project_id, type, assignee_id, reviewer_id, track } = form;
      await api.post('/tasks/batch', { project_id, type, assignee_id, reviewer_id, track, items });
      notify(t('platform.created', { n: items.length }), 'success');
      refresh();
      onClose();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('platform.planTitle')} onClose={onClose} wide>
      <form onSubmit={submit} className="form">
        <p className="muted">{t('platform.planIntro')}</p>
        <div className="grid-3">
          <label>
            {t('form.project')}
            <select value={form.project_id ?? ''} onChange={(e) => set('project_id')(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t('filter.noProject')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('form.type')}
            <select value={form.type} onChange={set('type')}>
              {['content_upload', 'platform_exam'].map((k) => (
                <option key={k} value={k}>
                  {typeLabel(k)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('form.track')}
            <TrackPicker value={form.track} onChange={set('track')} />
          </label>
          <label>
            {t('form.assignee')}
            <UserSelect users={assignable} value={form.assignee_id} onChange={set('assignee_id')} />
          </label>
          <label>
            {t('form.reviewer')}
            <UserSelect users={users} value={form.reviewer_id} onChange={set('reviewer_id')} placeholder={t('form.noReview')} />
          </label>
          <div className="grid-2">
            <label>
              {t('platform.firstDate')}
              <input type="date" value={form.first} onChange={set('first')} required />
            </label>
            <label>
              {t('platform.every')}
              <select value={form.every} onChange={set('every')}>
                {[1, 2, 3, 7, 14].map((n) => (
                  <option key={n} value={n}>
                    {t('platform.days', { n })}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <label>
          {t('platform.planItems')}
          <textarea rows={8} value={form.items} onChange={set('items')} placeholder={t('platform.planItemsPh')} required />
        </label>
        {items.length > 0 && (
          <div className="muted sm">
            {t('platform.preview', { n: items.length, first: formatDate(items[0].due_date), last: formatDate(items.at(-1).due_date) })}
          </div>
        )}
        <div className="row gap end">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!items.length || saving}>
            {t('platform.create', { n: items.length })}
          </button>
        </div>
      </form>
    </Modal>
  );
}
