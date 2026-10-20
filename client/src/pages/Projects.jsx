import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Avatar, DeptTag, Empty, Modal, Progress, UserSelect, formatDate } from '../components/ui.jsx';

export function ProjectForm({ project, onClose, onSaved }) {
  const { meta, user, users, deptOf } = useApp();
  const [error, setError] = useState('');
  const [form, setForm] = useState(() => ({
    name: project?.name || '',
    description: project?.description || '',
    department: project?.department || deptOf(user.role),
    status: project?.status || 'active',
    owner_id: project?.owner_id || user.id,
    start_date: project?.start_date || '',
    due_date: project?.due_date || '',
    color: project?.color || '#6366f1',
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
      title={project ? 'Edit project' : 'New project'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" form="project-form">
            {project ? 'Save' : 'Create project'}
          </button>
        </>
      }
    >
      <form id="project-form" className="form" onSubmit={submit}>
        {error && <div className="alert error">{error}</div>}
        <div className="grid-3">
          <label className="span-2">
            Name
            <input required autoFocus value={form.name} onChange={set('name')} />
          </label>
          <label>
            Color
            <input type="color" value={form.color} onChange={set('color')} />
          </label>
        </div>
        <label>
          Description
          <textarea rows={2} value={form.description} onChange={set('description')} />
        </label>
        <div className="grid-3">
          <label>
            Department
            <select value={form.department} onChange={set('department')}>
              {Object.entries(meta.departments).map(([k, d]) => (
                <option key={k} value={k}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={form.status} onChange={set('status')}>
              {meta.projectStatuses.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Owner
            <UserSelect users={users} value={form.owner_id} allowEmpty={false} onChange={(v) => setForm((f) => ({ ...f, owner_id: v }))} />
          </label>
          <label>
            Start date
            <input type="date" value={form.start_date || ''} onChange={set('start_date')} />
          </label>
          <label>
            Due date
            <input type="date" value={form.due_date || ''} onChange={set('due_date')} />
          </label>
        </div>
        <div>
          <div className="field-label">Members ({form.member_ids.length})</div>
          <div className="member-picker">
            {byDept.map(([d, list]) => (
              <div key={d}>
                <div className="muted sm">{meta.departments[d].label}</div>
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
  const { version, refresh, isManager, meta, notify } = useApp();
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
        <h1>Projects</h1>
        {isManager && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            + New project
          </button>
        )}
      </div>
      <div className="filters">
        <select value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">All departments</option>
          {Object.entries(meta.departments).map(([k, d]) => (
            <option key={k} value={k}>
              {d.label}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        </label>
      </div>
      {projects && projects.length === 0 && <Empty icon="▤">No projects yet. {isManager ? 'Create one to group related tasks.' : 'You will see projects you are added to here.'}</Empty>}
      <div className="project-grid">
        {projects?.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="card project-card" style={{ '--c': p.color }}>
            <div className="row between">
              <DeptTag department={p.department} />
              <span className={`pill pstatus-${p.status}`}>{meta.projectStatuses.find((s) => s.key === p.status)?.label}</span>
            </div>
            <h3>{p.name}</h3>
            <p className="muted clamp">{p.description}</p>
            <Progress value={p.done_count} total={p.task_count} color={p.color} />
            <div className="row between sm">
              <span className="muted">
                {p.done_count}/{p.task_count} done
                {p.overdue_count > 0 && <span className="text-danger"> · {p.overdue_count} overdue</span>}
              </span>
              {p.due_date && <span className="muted">Due {formatDate(p.due_date)}</span>}
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
            notify('Project created', 'success');
            navigate(`/projects/${p.id}`);
          }}
        />
      )}
    </div>
  );
}
