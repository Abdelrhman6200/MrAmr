import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Modal, UserSelect, useTaskDialog } from './ui.jsx';

export default function TaskForm() {
  const { meta, user, refresh, notify, users } = useApp();
  const { params, close, open } = useTaskDialog();
  const [projects, setProjects] = useState([]);
  const [assignable, setAssignable] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    title: '',
    description: '',
    project_id: params.get('new_project_id') ? Number(params.get('new_project_id')) : null,
    type: params.get('new_type') || 'general',
    status: params.get('new_status') || 'todo',
    priority: 'medium',
    assignee_id: params.get('new_assignee_id') ? Number(params.get('new_assignee_id')) : user.id,
    reviewer_id: null,
    due_date: params.get('new_due_date') || '',
    estimate_hours: '',
    tags: '',
    checklist: '',
  }));
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));

  useEffect(() => {
    api.get('/projects').then(setProjects).catch(() => {});
  }, []);
  useEffect(() => {
    api.get('/users/assignable', { project_id: form.project_id }).then(setAssignable).catch(() => {});
  }, [form.project_id]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const t = await api.post('/tasks', {
        ...form,
        checklist: form.checklist.split('\n').map((s) => s.trim()).filter(Boolean),
      });
      refresh();
      notify('Task created', 'success');
      open(t.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const statuses = meta.statuses.filter((s) => s.key !== 'done' || !form.reviewer_id);

  return (
    <Modal
      title="New task"
      onClose={close}
      wide
      footer={
        <>
          <button className="btn" type="button" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" form="task-form" disabled={saving}>
            {saving ? 'Creating…' : 'Create task'}
          </button>
        </>
      }
    >
      <form id="task-form" className="form" onSubmit={submit}>
        {error && <div className="alert error">{error}</div>}
        <label>
          Title
          <input autoFocus required value={form.title} onChange={set('title')} placeholder="e.g. Record Lesson 4: Momentum" />
        </label>
        <label>
          Description
          <textarea rows={3} value={form.description} onChange={set('description')} placeholder="Details, links, acceptance criteria…" />
        </label>
        <div className="grid-3">
          <label>
            Project
            <select value={form.project_id ?? ''} onChange={(e) => set('project_id')(e.target.value ? Number(e.target.value) : null)}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select value={form.type} onChange={set('type')}>
              {meta.taskTypes.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select value={form.priority} onChange={set('priority')}>
              {meta.priorities.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assignee
            <UserSelect users={assignable} value={form.assignee_id} onChange={set('assignee_id')} />
          </label>
          <label>
            Reviewer / QA <span className="hint">(must approve before done)</span>
            <UserSelect users={users} value={form.reviewer_id} onChange={set('reviewer_id')} placeholder="No review needed" />
          </label>
          <label>
            Status
            <select value={form.status} onChange={set('status')}>
              {statuses.map((s) => (
                <option key={s.key} value={s.key} disabled={s.key === 'in_review' && !form.reviewer_id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Due date
            <input type="date" value={form.due_date} onChange={set('due_date')} />
          </label>
          <label>
            Estimate (hours)
            <input type="number" min="0" step="0.5" value={form.estimate_hours} onChange={set('estimate_hours')} />
          </label>
          <label>
            Tags <span className="hint">(comma separated)</span>
            <input value={form.tags} onChange={set('tags')} placeholder="video, lesson" />
          </label>
        </div>
        <label>
          Checklist <span className="hint">(one item per line)</span>
          <textarea rows={3} value={form.checklist} onChange={set('checklist')} placeholder={'Script\nRecord\nEdit\nUpload'} />
        </label>
      </form>
    </Modal>
  );
}
