import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Modal, TrackPicker, TypeOptions, UserSelect, typesFor, useSops, useTaskDialog } from './ui.jsx';
import { sopSteps } from '../sops.js';

export default function TaskForm() {
  const { meta, user, refresh, notify, users, t, lang, priorityLabel, statusLabel } = useApp();
  const [sops] = useSops();
  // The checklist follows the type's SOP until someone edits it by hand.
  const [ownChecklist, setOwnChecklist] = useState(false);
  const { params, close, open } = useTaskDialog();
  const [projects, setProjects] = useState([]);
  const [assignable, setAssignable] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    title: '',
    description: '',
    project_id: params.get('new_project_id') ? Number(params.get('new_project_id')) : null,
    // The academic team starts on its first work type.
    type: params.get('new_type') || (meta.roles[user.role]?.department === 'academic' ? typesFor(meta, user).find((x) => x.group === 'academic').key : 'general'),
    status: params.get('new_status') || 'todo',
    priority: 'medium',
    assignee_id: params.get('new_assignee_id') ? Number(params.get('new_assignee_id')) : user.id,
    reviewer_id: null,
    due_date: params.get('new_due_date') || '',
    estimate_hours: '',
    tags: '',
    track: '',
    checklist: '',
  }));
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));

  useEffect(() => {
    api.get('/projects').then(setProjects).catch(() => {});
  }, []);
  useEffect(() => {
    if (sops && !ownChecklist) setForm((f) => ({ ...f, checklist: sopSteps(f.type, lang, sops).join('\n') }));
  }, [form.type, sops, lang, ownChecklist]);
  useEffect(() => {
    api.get('/users/assignable', { project_id: form.project_id }).then(setAssignable).catch(() => {});
  }, [form.project_id]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const created = await api.post('/tasks', {
        ...form,
        // Still loading the SOPs: let the server add them.
        checklist: ownChecklist || sops ? form.checklist.split('\n').map((s) => s.trim()).filter(Boolean) : undefined,
      });
      refresh();
      notify(t('form.created'), 'success');
      open(created.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const statuses = meta.statuses.filter((s) => s.key !== 'done' || !form.reviewer_id);

  return (
    <Modal
      title={t('form.newTask')}
      onClose={close}
      wide
      footer={
        <>
          <button className="btn" type="button" onClick={close}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" form="task-form" disabled={saving}>
            {saving ? t('form.creating') : t('form.create')}
          </button>
        </>
      }
    >
      <form id="task-form" className="form" onSubmit={submit}>
        {error && <div className="alert error">{error}</div>}
        <label>
          {t('form.title')}
          <input autoFocus required value={form.title} onChange={set('title')} placeholder={t('form.titlePh')} />
        </label>
        <label>
          {t('form.description')}
          <textarea rows={3} value={form.description} onChange={set('description')} placeholder={t('form.descriptionPh')} />
        </label>
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
              <TypeOptions current={form.type} />
            </select>
          </label>
          <label>
            {t('form.track')}
            <TrackPicker value={form.track} onChange={set('track')} />
          </label>
          <label>
            {t('form.priority')}
            <select value={form.priority} onChange={set('priority')}>
              {meta.priorities.map((p) => (
                <option key={p.key} value={p.key}>
                  {priorityLabel(p.key)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('form.assignee')}
            <UserSelect users={assignable} value={form.assignee_id} onChange={set('assignee_id')} />
          </label>
          <label>
            {t('form.reviewer')} <span className="hint">{t('form.reviewerHint')}</span>
            <UserSelect users={users} value={form.reviewer_id} onChange={set('reviewer_id')} placeholder={t('form.noReview')} />
          </label>
          <label>
            {t('form.status')}
            <select value={form.status} onChange={set('status')}>
              {statuses.map((s) => (
                <option key={s.key} value={s.key} disabled={s.key === 'in_review' && !form.reviewer_id}>
                  {statusLabel(s.key)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('form.due')}
            <input type="date" value={form.due_date} onChange={set('due_date')} />
          </label>
          <label>
            {t('form.estimate')}
            <input type="number" min="0" step="0.5" value={form.estimate_hours} onChange={set('estimate_hours')} />
          </label>
          <label>
            {t('form.tags')} <span className="hint">{t('form.tagsHint')}</span>
            <input value={form.tags} onChange={set('tags')} placeholder="video, lesson" />
          </label>
        </div>
        <label>
          {t('form.checklist')} <span className="hint">{ownChecklist ? t('form.checklistHint') : t('form.checklistSop')}</span>
          <textarea
            rows={Math.min(Math.max(form.checklist.split('\n').length, 3), 8)}
            value={form.checklist}
            onChange={(e) => {
              setOwnChecklist(true);
              set('checklist')(e);
            }}
            placeholder={t('form.checklistPh')}
          />
        </label>
      </form>
    </Modal>
  );
}
