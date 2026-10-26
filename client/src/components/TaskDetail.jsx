import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Avatar, Modal, PriorityTag, StatusPill, TrackPicker, TrackTag, TypeOptions, TypeTag, UserSelect, isOverdue, timeAgo, useSops, useTaskDialog } from './ui.jsx';
import { sopFor } from '../sops.js';
import Icon from './Icon.jsx';

function ReviewBox({ task, onDone }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const { notify, t } = useApp();
  const send = async (decision) => {
    setError('');
    try {
      await api.post(`/tasks/${task.id}/review`, { decision, comment });
      notify(decision === 'approve' ? t('task.approved') : t('task.sentBack'), 'success');
      setComment('');
      onDone();
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <div className="review-box">
      <strong>{t('task.reviewRequested')}</strong>
      <p className="muted">{t('task.reviewExplain', { name: task.assignee_name || t('task.theAssignee') })}</p>
      <textarea rows={2} placeholder={t('task.feedbackPh')} value={comment} onChange={(e) => setComment(e.target.value)} />
      {error && <div className="alert error">{error}</div>}
      <div className="row gap">
        <button className="btn success" onClick={() => send('approve')}>
          <Icon name="check" />{t('task.approve')}
        </button>
        <button className="btn warn" onClick={() => send('changes')}>
          <Icon name="undo" />{t('task.requestChanges')}
        </button>
      </div>
    </div>
  );
}

export default function TaskDetail({ id }) {
  const { meta, refresh, version, notify, users, user, t, lang, statusLabel, priorityLabel } = useApp();
  const [sops] = useSops();
  const { close } = useTaskDialog();
  const [task, setTask] = useState(null);
  const [error, setError] = useState('');
  const [assignable, setAssignable] = useState([]);
  const [projects, setProjects] = useState([]);
  const [comment, setComment] = useState('');
  const [newItem, setNewItem] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [tab, setTab] = useState('comments');

  const load = useCallback(() => {
    api
      .get(`/tasks/${id}`)
      .then((data) => {
        setTask(data);
        setError('');
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(load, [load, version]);
  useEffect(() => {
    api.get('/projects').then(setProjects).catch(() => {});
  }, []);
  useEffect(() => {
    if (task) api.get('/users/assignable', { project_id: task.project_id }).then(setAssignable).catch(() => {});
  }, [task?.project_id]);

  if (error)
    return (
      <Modal title={t('nav.tasks')} onClose={close}>
        <div className="alert error">{error}</div>
      </Modal>
    );
  if (!task) return null;

  // The required SOP steps still open are listed with the error.
  const failed = (e) => notify(e.code === 'required_steps' ? `${e.message}: ${e.details.steps.join(' · ')}` : e.message, 'error');

  const update = async (patch) => {
    try {
      await api.patch(`/tasks/${task.id}`, patch);
      refresh();
    } catch (e) {
      failed(e);
      load();
    }
  };

  const addComment = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    await api.post(`/tasks/${task.id}/comments`, { body: comment });
    setComment('');
    refresh();
  };

  const addItem = async (e) => {
    e.preventDefault();
    if (!newItem.trim()) return;
    await api.post(`/tasks/${task.id}/checklist`, { text: newItem });
    setNewItem('');
    refresh();
  };

  // A task with an empty checklist can take its type's SOP steps in one go.
  const addSop = () => api.post(`/tasks/${task.id}/checklist/sop`).then(refresh, failed);
  const sop = sops && sopFor(task.type, lang, sops);
  const requiredLeft = task.checklist.filter((c) => c.required && !c.done).length;

  const remove = async () => {
    if (!confirm(t('task.confirmDelete', { title: task.title }))) return;
    await api.del(`/tasks/${task.id}`);
    notify(t('task.deleted'));
    close();
    refresh();
  };

  const ro = !task.can_edit;
  // Include the current assignee even if they're outside the assignable set.
  const assigneeOptions = assignable.some((u) => u.id === task.assignee_id) || !task.assignee_id ? assignable : [...assignable, users.find((u) => u.id === task.assignee_id)].filter(Boolean);
  const statusOptions = meta.statuses.filter((s) => !(s.key === 'done' && task.reviewer_id && !task.can_review && task.status !== 'done'));

  return (
    <Modal title={t('task.heading', { id: task.id })} onClose={close} wide>
      <div className="task-detail">
        <div className="task-main">
          {editingTitle && !ro ? (
            <input
              className="title-input"
              autoFocus
              defaultValue={task.title}
              onBlur={(e) => {
                setEditingTitle(false);
                if (e.target.value.trim() && e.target.value !== task.title) update({ title: e.target.value });
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
            />
          ) : (
            <h3 className="task-title" onClick={() => setEditingTitle(true)} title={ro ? '' : t('task.clickEdit')}>
              {task.title}
            </h3>
          )}
          <div className="row gap wrap">
            <StatusPill status={task.status} />
            <PriorityTag priority={task.priority} />
            <TypeTag type={task.type} />
            <TrackTag track={task.track} />
            {isOverdue(task) && <span className="pill overdue-pill">{t('task.overdue')}</span>}
            {task.tags &&
              task.tags.split(',').map((tag) => (
                <span key={tag} className="tag subtle">
                  #{tag}
                </span>
              ))}
          </div>

          {task.status === 'in_review' && task.can_review && <ReviewBox task={task} onDone={refresh} />}
          {task.status === 'in_review' && !task.can_review && (
            <div className="alert info">{t('task.waitingFor', { name: task.reviewer_name })}</div>
          )}

          <section>
            <h4>{t('form.description')}</h4>
            <textarea
              className="desc"
              rows={4}
              disabled={ro}
              defaultValue={task.description}
              key={`d${task.id}${task.updated_at}`}
              placeholder={ro ? t('task.noDescription') : t('task.addDescription')}
              onBlur={(e) => e.target.value !== task.description && update({ description: e.target.value })}
            />
          </section>

          <section>
            <h4>
              {t('tasks.checklist')} {task.checklist.length > 0 && <span className="muted">{task.checklist.filter((c) => c.done).length}/{task.checklist.length}</span>}
              {requiredLeft > 0 && task.status !== 'done' && <span className="req-left">{t('sop.requiredLeft', { n: requiredLeft })}</span>}
            </h4>
            {sop && sop.steps.length > 0 && (
              <div className="sop-hint">
                <Icon name="checklist" size={15} />
                <div>
                  {sop.target && (
                    <div>
                      <b>{t('sop.target')}:</b> {sop.target}
                    </div>
                  )}
                  {sop.done && (
                    <div>
                      <b>{t('sop.done')}:</b> {sop.done}
                    </div>
                  )}
                  <Link className="link sm" to={`/sops?type=${task.type}`} onClick={close}>
                    {t('sop.view')}
                  </Link>
                </div>
              </div>
            )}
            <ul className="checklist">
              {task.checklist.map((c) => (
                <li key={c.id}>
                  <label className={c.done ? 'done' : ''}>
                    <input
                      type="checkbox"
                      checked={c.done}
                      disabled={ro}
                      onChange={(e) => api.patch(`/tasks/${task.id}/checklist/${c.id}`, { done: e.target.checked }).then(refresh)}
                    />
                    {c.text}
                    {c.required && <span className="req-badge">{t('sop.required')}</span>}
                  </label>
                  {!ro && (
                    <button className="icon-btn sm" onClick={() => api.del(`/tasks/${task.id}/checklist/${c.id}`).then(refresh, failed)} aria-label={t('task.removeItem')}>
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!ro && task.checklist.length === 0 && sop?.steps.length > 0 && (
              <button className="btn sm sop-add" onClick={addSop}>
                <Icon name="checklist" size={14} /> {t('sop.addSteps')}
              </button>
            )}
            {!ro && (
              <form onSubmit={addItem} className="row gap">
                <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder={t('task.addItem')} />
                <button className="btn">{t('common.add')}</button>
              </form>
            )}
          </section>

          <section>
            <div className="tabs">
              <button className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')}>
                {t('task.comments', { n: task.comments.length })}
              </button>
              <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>
                {t('task.activity')}
              </button>
            </div>
            {tab === 'comments' ? (
              <>
                <div className="comments">
                  {task.comments.length === 0 && <div className="muted">{t('task.noComments')}</div>}
                  {task.comments.map((c) => (
                    <div key={c.id} className="comment">
                      <Avatar name={c.user_name} color={c.avatar_color} size={28} />
                      <div className="grow">
                        <div className="comment-head">
                          <strong>{c.user_name}</strong> <small className="muted">{timeAgo(c.created_at)}</small>
                          {(c.user_id === user.id || user.role === 'ceo') && (
                            <button className="link sm" onClick={() => api.del(`/tasks/${task.id}/comments/${c.id}`).then(refresh)}>
                              {t('common.delete')}
                            </button>
                          )}
                        </div>
                        <div className="comment-body">{c.body}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <form onSubmit={addComment} className="comment-form">
                  <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('task.writeComment')} />
                  <button className="btn primary" disabled={!comment.trim()}>
                    {t('task.comment')}
                  </button>
                </form>
              </>
            ) : (
              <ul className="activity">
                {task.activity.map((a) => (
                  <li key={a.id}>
                    <strong>{a.user_name}</strong> <ActivityText a={a} /> <small className="muted">{timeAgo(a.created_at)}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="task-side">
          <Field label={t('form.status')}>
            <select value={task.status} disabled={ro} onChange={(e) => update({ status: e.target.value })}>
              {statusOptions.map((s) => (
                <option key={s.key} value={s.key} disabled={s.key === 'in_review' && !task.reviewer_id}>
                  {statusLabel(s.key)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('form.assignee')}>
            <UserSelect users={assigneeOptions} value={task.assignee_id} disabled={ro} onChange={(v) => update({ assignee_id: v })} />
          </Field>
          <Field label={t('form.reviewer')}>
            <UserSelect users={users} value={task.reviewer_id} disabled={ro || !task.can_change_reviewer} placeholder={t('form.noReview')} onChange={(v) => update({ reviewer_id: v })} />
          </Field>
          <Field label={t('form.priority')}>
            <select value={task.priority} disabled={ro} onChange={(e) => update({ priority: e.target.value })}>
              {meta.priorities.map((p) => (
                <option key={p.key} value={p.key}>
                  {priorityLabel(p.key)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('form.type')}>
            <select value={task.type} disabled={ro} onChange={(e) => update({ type: e.target.value })}>
              <TypeOptions current={task.type} />
            </select>
          </Field>
          <Field label={t('form.track')}>
            <TrackPicker value={task.track} disabled={ro} onChange={(v) => update({ track: v })} />
          </Field>
          <Field label={t('form.project')}>
            <select value={task.project_id ?? ''} disabled={ro} onChange={(e) => update({ project_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{t('filter.noProject')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {task.project_id && !projects.some((p) => p.id === task.project_id) && <option value={task.project_id}>{task.project_name}</option>}
            </select>
            {task.project_id && (
              <Link className="link sm" to={`/projects/${task.project_id}`} onClick={close}>
                {t('task.openProject')}
              </Link>
            )}
          </Field>
          <Field label={t('form.due')}>
            <input type="date" value={task.due_date || ''} disabled={ro} onChange={(e) => update({ due_date: e.target.value })} />
          </Field>
          <Field label={t('task.estimate')}>
            <input
              type="number"
              min="0"
              step="0.5"
              defaultValue={task.estimate_hours ?? ''}
              key={`e${task.updated_at}`}
              disabled={ro}
              onBlur={(e) => String(task.estimate_hours ?? '') !== e.target.value && update({ estimate_hours: e.target.value })}
            />
          </Field>
          <Field label={t('form.tags')}>
            <input
              defaultValue={task.tags}
              key={`t${task.updated_at}`}
              disabled={ro}
              placeholder={t('task.tagsPh')}
              onBlur={(e) => e.target.value !== task.tags && update({ tags: e.target.value })}
            />
          </Field>
          <div className="meta-lines muted">
            <div>{t('task.createdBy', { name: task.reporter_name })}</div>
            <div>{timeAgo(task.created_at)}</div>
            {task.completed_at && <div>{t('task.completedAgo', { when: timeAgo(task.completed_at) })}</div>}
          </div>
          {ro && <div className="alert info sm">{t('task.readOnly')}</div>}
          {task.can_delete && (
            <button className="btn danger block" onClick={remove}>
              {t('task.delete')}
            </button>
          )}
        </aside>
      </div>
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

const ACTIONS = ['created', 'status', 'assigned', 'reviewer', 'updated', 'approved', 'changes_requested'];

export function ActivityText({ a, withTask }) {
  const { t, statusLabel, dir } = useApp();
  let detail = a.detail;
  // Status changes are stored as "todo→done" keys (older rows hold English labels).
  if (a.action === 'status' && detail?.includes('→')) detail = detail.split('→').map((s) => statusLabel(s.trim())).join(dir === 'rtl' ? ' ← ' : ' → ');
  return (
    <span>
      {ACTIONS.includes(a.action) ? t(`act.${a.action}`) : a.action} {a.action !== 'changes_requested' && a.action !== 'created' && detail && <em>{detail}</em>}
      {withTask && a.task_title && (
        <>
          {' '}
          {t('act.on')} <b>{a.task_title}</b>
        </>
      )}
    </span>
  );
}
