import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Avatar, DeptTag, Empty, Modal, Progress, UserSelect, formatDate } from '../components/ui.jsx';

export function ProjectForm({ project, onClose, onSaved }) {
  const { meta, user, users, deptOf, t, deptLabel, projectStatusLabel } = useApp();
  const [error, setError] = useState('');
  const [form, setForm] = useState(() => ({
    name: project?.name || '',
    description: project?.description || '',
    department: project?.department || deptOf(user.role),
    status: project?.status || 'active',
    owner_id: project?.owner_id || user.id,
    start_date: project?.start_date || '',
    due_date: project?.due_date || '',
    color: project?.color || '#16a34a',
    member_ids: project?.members?.map((m) => m.id) || [user.id],
  }));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const toggleMember = (id) =>
    setForm((f) => ({ ...f, member_ids: f.member_ids.includes(id) ? f.member_ids.filter((x) => x !== id) : [...f.member_ids, id] }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const saved = project ? await api.patch(`/projects/${project.id}`, form) : await api.post('/projects', form);
      onSaved(saved);
    } catch (err) {
      setError(err.message);
    }
  };

  // Group the member picker by department for a large org.
  const byDept = Object.keys(meta.departments)
    .map((d) => [d, users.filter((u) => deptOf(u.role) === d)])
    .filter(([, list]) => list.length);

  return (
    <Modal
      title={project ? t('proj.editTitle') : t('proj.newTitle')}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" form="project-form">
            {project ? t('common.save') : t('proj.create')}
          </button>
        </>
      }
    >
      <form id="project-form" className="form" onSubmit={submit}>
        {error && <div className="alert error">{error}</div>}
        <div className="grid-3">
          <label className="span-2">
            {t('proj.name')}
            <input required autoFocus value={form.name} onChange={set('name')} />
          </label>
          <label>
            {t('proj.color')}
            <input type="color" value={form.color} onChange={set('color')} />
          </label>
        </div>
        <label>
          {t('form.description')}
          <textarea rows={2} value={form.description} onChange={set('description')} />
        </label>
        <div className="grid-3">
          <label>
            {t('proj.department')}
            <select value={form.department} onChange={set('department')}>
              {Object.keys(meta.departments).map((k) => (
                <option key={k} value={k}>
                  {deptLabel(k)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('proj.status')}
            <select value={form.status} onChange={set('status')}>
              {meta.projectStatuses.map((s) => (
                <option key={s.key} value={s.key}>
                  {projectStatusLabel(s.key)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('proj.owner')}
            <UserSelect users={users} value={form.owner_id} allowEmpty={false} onChange={(v) => setForm((f) => ({ ...f, owner_id: v }))} />
          </label>
          <label>
            {t('proj.start')}
            <input type="date" value={form.start_date || ''} onChange={set('start_date')} />
          </label>
          <label>
            {t('form.due')}
            <input type="date" value={form.due_date || ''} onChange={set('due_date')} />
          </label>
        </div>
        <div>
          <div className="field-label">{t('proj.members', { n: form.member_ids.length })}</div>
          <div className="member-picker">
            {byDept.map(([d, list]) => (
              <div key={d}>
                <div className="muted sm">{deptLabel(d)}</div>
                {list.map((u) => (
                  <label key={u.id} className="check">
                    <input type="checkbox" checked={form.member_ids.includes(u.id)} onChange={() => toggleMember(u.id)} /> {u.name}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default function Projects() {
  const { version, refresh, isManager, meta, notify, t, deptLabel, projectStatusLabel } = useApp();
  const [projects, setProjects] = useState(null);
  const [dept, setDept] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/projects', { department: dept, include_archived: showArchived ? '1' : '' }).then(setProjects);
  }, [version, dept, showArchived]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('proj.title')}</h1>
        {isManager && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            {t('proj.new')}
          </button>
        )}
      </div>
      <div className="filters">
        <select value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">{t('proj.allDepts')}</option>
          {Object.keys(meta.departments).map((k) => (
            <option key={k} value={k}>
              {deptLabel(k)}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> {t('proj.showArchived')}
        </label>
      </div>
      {projects && projects.length === 0 && <Empty icon="▤">{isManager ? t('proj.emptyManager') : t('proj.emptyMember')}</Empty>}
      <div className="project-grid">
        {projects?.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="card project-card" style={{ '--c': p.color }}>
            <div className="row between">
              <DeptTag department={p.department} />
              <span className={`pill pstatus-${p.status}`}>{projectStatusLabel(p.status)}</span>
            </div>
            <h3>{p.name}</h3>
            <p className="muted clamp">{p.description}</p>
            <Progress value={p.done_count} total={p.task_count} color={p.color} />
            <div className="row between sm">
              <span className="muted">
                {t('proj.doneOf', { done: p.done_count, total: p.task_count })}
                {p.overdue_count > 0 && <span className="text-danger"> · {t('proj.overdue', { n: p.overdue_count })}</span>}
              </span>
              {p.due_date && <span className="muted">{t('proj.dueOn', { date: formatDate(p.due_date) })}</span>}
            </div>
            <div className="avatars">
              {p.members.slice(0, 6).map((m) => (
                <Avatar key={m.id} name={m.name} color={m.avatar_color} size={24} />
              ))}
              {p.members.length > 6 && <span className="muted sm">+{p.members.length - 6}</span>}
            </div>
          </Link>
        ))}
      </div>
      {creating && (
        <ProjectForm
          onClose={() => setCreating(false)}
          onSaved={(p) => {
            setCreating(false);
            refresh();
            notify(t('proj.created'), 'success');
            navigate(`/projects/${p.id}`);
          }}
        />
      )}
    </div>
  );
}
