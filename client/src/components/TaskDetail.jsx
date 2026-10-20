import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Avatar, Modal, PriorityTag, StatusPill, TypeTag, UserSelect, isOverdue, timeAgo, useTaskDialog } from './ui.jsx';

function ReviewBox({ task, onDone }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const { notify } = useApp();
  const send = async (decision) => {
    setError('');
    try {
      await api.post(`/tasks/${task.id}/review`, { decision, comment });
      notify(decision === 'approve' ? 'Approved — task is done' : 'Sent back with changes', 'success');
      setComment('');
      onDone();
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <div className="review-box">
      <strong>Review requested</strong>
      <p className="muted">
        {task.assignee_name || 'The assignee'} sent this for your review. Approve to mark it done, or request changes to send it back.
      </p>
      <textarea rows={2} placeholder="Feedback (required when requesting changes)" value={comment} onChange={(e) => setComment(e.target.value)} />
      {error && <div className="alert error">{error}</div>}
      <div className="row gap">
        <button className="btn success" onClick={() => send('approve')}>
          ✓ Approve
        </button>
        <button className="btn warn" onClick={() => send('changes')}>
          ↺ Request changes
        </button>
      </div>
    </div>
  );
}

export default function TaskDetail({ id }) {
  const { meta, refresh, version, notify, users, user } = useApp();
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
      .then((t) => {
        setTask(t);
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
      <Modal title="Task" onClose={close}>
        <div className="alert error">{error}</div>
      </Modal>
    );
  if (!task) return null;

  const update = async (patch) => {
    try {
      await api.patch(`/tasks/${task.id}`, patch);
      refresh();
    } catch (e) {
      notify(e.message, 'error');
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

  const remove = async () => {
    if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
    await api.del(`/tasks/${task.id}`);
    notify('Task deleted');
    close();
    refresh();
  };

  const ro = !task.can_edit;
  // Include the current assignee even if they're outside the assignable set.
  const assigneeOptions = assignable.some((u) => u.id === task.assignee_id) || !task.assignee_id ? assignable : [...assignable, users.find((u) => u.id === task.assignee_id)].filter(Boolean);
  const statusOptions = meta.statuses.filter((s) => !(s.key === 'done' && task.reviewer_id && !task.can_review && task.status !== 'done'));

  return (
    <Modal title={`Task #${task.id}`} onClose={close} wide>
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
            <h3 className="task-title" onClick={() => setEditingTitle(true)} title={ro ? '' : 'Click to edit'}>
              {task.title}
            </h3>
          )}
          <div className="row gap wrap">
            <StatusPill status={task.status} />
            <PriorityTag priority={task.priority} />
            <TypeTag type={task.type} />
            {isOverdue(task) && <span className="pill overdue-pill">Overdue</span>}
            {task.tags &&
              task.tags.split(',').map((t) => (
                <span key={t} className="tag subtle">
                  #{t}
                </span>
              ))}
          </div>

          {task.status === 'in_review' && task.can_review && <ReviewBox task={task} onDone={refresh} />}
          {task.status === 'in_review' && !task.can_review && (
            <div className="alert info">Waiting for {task.reviewer_name} to review.</div>
          )}

          <section>
            <h4>Description</h4>
            <textarea
              className="desc"
              rows={4}
              disabled={ro}
              defaultValue={task.description}
              key={`d${task.id}${task.updated_at}`}
              placeholder={ro ? 'No description' : 'Add a description…'}
              onBlur={(e) => e.target.value !== task.description && update({ description: e.target.value })}
            />
          </section>

          <section>
            <h4>
              Checklist {task.checklist.length > 0 && <span className="muted">{task.checklist.filter((c) => c.done).length}/{task.checklist.length}</span>}
            </h4>
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
                  </label>
                  {!ro && (
                    <button className="icon-btn sm" onClick={() => api.del(`/tasks/${task.id}/checklist/${c.id}`).then(refresh)} aria-label="Remove item">
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!ro && (
              <form onSubmit={addItem} className="row gap">
                <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an item…" />
                <button className="btn">Add</button>
              </form>
            )}
          </section>

          <section>
            <div className="tabs">
              <button className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')}>
                Comments ({task.comments.length})
              </button>
              <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>
                Activity
              </button>
            </div>
            {tab === 'comments' ? (
              <>
                <div className="comments">
                  {task.comments.length === 0 && <div className="muted">No comments yet.</div>}
                  {task.comments.map((c) => (
                    <div key={c.id} className="comment">
                      <Avatar name={c.user_name} color={c.avatar_color} size={28} />
                      <div className="grow">
                        <div className="comment-head">
                          <strong>{c.user_name}</strong> <small className="muted">{timeAgo(c.created_at)}</small>
                          {(c.user_id === user.id || user.role === 'ceo') && (
                            <button className="link sm" onClick={() => api.del(`/tasks/${task.id}/comments/${c.id}`).then(refresh)}>
                              delete
                            </button>
                          )}
                        </div>
                        <div className="comment-body">{c.body}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <form onSubmit={addComment} className="comment-form">
                  <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment…" />
                  <button className="btn primary" disabled={!comment.trim()}>
                    Comment
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
          <Field label="Status">
            <select value={task.status} disabled={ro} onChange={(e) => update({ status: e.target.value })}>
              {statusOptions.map((s) => (
                <option key={s.key} value={s.key} disabled={s.key === 'in_review' && !task.reviewer_id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assignee">
            <UserSelect users={assigneeOptions} value={task.assignee_id} disabled={ro} onChange={(v) => update({ assignee_id: v })} />
          </Field>
          <Field label="Reviewer / QA">
            <UserSelect users={users} value={task.reviewer_id} disabled={ro} placeholder="No review needed" onChange={(v) => update({ reviewer_id: v })} />
          </Field>
          <Field label="Priority">
            <select value={task.priority} disabled={ro} onChange={(e) => update({ priority: e.target.value })}>
              {meta.priorities.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select value={task.type} disabled={ro} onChange={(e) => update({ type: e.target.value })}>
              {meta.taskTypes.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Project">
            <select value={task.project_id ?? ''} disabled={ro} onChange={(e) => update({ project_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {task.project_id && !projects.some((p) => p.id === task.project_id) && <option value={task.project_id}>{task.project_name}</option>}
            </select>
            {task.project_id && (
              <Link className="link sm" to={`/projects/${task.project_id}`} onClick={close}>
                Open project →
              </Link>
            )}
          </Field>
          <Field label="Due date">
            <input type="date" value={task.due_date || ''} disabled={ro} onChange={(e) => update({ due_date: e.target.value })} />
          </Field>
          <Field label="Estimate (h)">
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
          <Field label="Tags">
            <input
              defaultValue={task.tags}
              key={`t${task.updated_at}`}
              disabled={ro}
              placeholder="comma, separated"
              onBlur={(e) => e.target.value !== task.tags && update({ tags: e.target.value })}
            />
          </Field>
          <div className="meta-lines muted">
            <div>Created by {task.reporter_name}</div>
            <div>{timeAgo(task.created_at)}</div>
            {task.completed_at && <div>Completed {timeAgo(task.completed_at)}</div>}
          </div>
          {ro && <div className="alert info sm">You can view and comment on this task, but not edit it.</div>}
          {task.can_delete && (
            <button className="btn danger block" onClick={remove}>
              Delete task
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

const ACTIONS = {
  created: 'created the task',
  status: 'changed status',
  assigned: 'assigned to',
  reviewer: 'set reviewer to',
  updated: 'updated',
  approved: 'approved the task',
  changes_requested: 'requested changes',
};

export function ActivityText({ a, withTask }) {
  return (
    <span>
      {ACTIONS[a.action] || a.action} {a.action !== 'changes_requested' && a.action !== 'created' && a.detail && <em>{a.detail}</em>}
      {withTask && a.task_title && (
        <>
          {' '}
          on <b>{a.task_title}</b>
        </>
      )}
    </span>
  );
}
