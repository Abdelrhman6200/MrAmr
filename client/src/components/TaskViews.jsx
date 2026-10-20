import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Avatar, DueDate, Empty, PriorityTag, StatusPill, TypeTag, useTaskDialog } from './ui.jsx';

export function TaskCard({ task, draggable, compact }) {
  const { open } = useTaskDialog();
  return (
    <div
      className={`card task-card prio-${task.priority}`}
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', String(task.id))}
      onClick={() => open(task.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && open(task.id)}
    >
      {task.project_name && !compact && (
        <div className="card-project" style={{ color: task.project_color }}>
          ● {task.project_name}
        </div>
      )}
      <div className="card-title">{task.title}</div>
      <div className="card-meta">
        <PriorityTag priority={task.priority} />
        <TypeTag type={task.type} />
      </div>
      <div className="card-foot">
        <DueDate task={task} />
        <span className="card-icons muted">
          {task.checklist_total > 0 && (
            <span title="Checklist">
              ☑ {task.checklist_done}/{task.checklist_total}
            </span>
          )}
          {task.comment_count > 0 && <span title="Comments">💬 {task.comment_count}</span>}
          {task.reviewer_name && <span title={`Reviewer: ${task.reviewer_name}`}>👁</span>}
        </span>
        {task.assignee_name ? <Avatar name={task.assignee_name} color={task.assignee_color} size={24} /> : <span className="avatar empty-avatar">?</span>}
      </div>
    </div>
  );
}

export function Board({ tasks, onChanged, newTaskDefaults = {} }) {
  const { meta, notify } = useApp();
  const { create } = useTaskDialog();
  const [over, setOver] = useState(null);

  const drop = async (status, e) => {
    e.preventDefault();
    setOver(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    try {
      await api.patch(`/tasks/${id}`, { status });
      onChanged?.();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <div className="board">
      {meta.statuses.map((s) => {
        const col = tasks.filter((t) => t.status === s.key);
        return (
          <div
            key={s.key}
            className={`column ${over === s.key ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(s.key);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => drop(s.key, e)}
          >
            <div className="column-head">
              <StatusPill status={s.key} />
              <span className="count">{col.length}</span>
              {s.key !== 'done' && s.key !== 'in_review' && (
                <button className="icon-btn sm" title="Add task" onClick={() => create({ ...newTaskDefaults, status: s.key })}>
                  +
                </button>
              )}
            </div>
            <div className="column-body">
              {col.map((t) => (
                <TaskCard key={t.id} task={t} draggable />
              ))}
              {col.length === 0 && <div className="column-empty">Drop tasks here</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TaskTable({ tasks, hideProject }) {
  const { open } = useTaskDialog();
  if (!tasks.length) return <Empty>No tasks match.</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Task</th>
            {!hideProject && <th>Project</th>}
            <th>Status</th>
            <th>Priority</th>
            <th>Assignee</th>
            <th>Due</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} onClick={() => open(t.id)} className="clickable">
              <td>
                <div className="cell-title">{t.title}</div>
                <div className="muted sm">
                  <TypeTag type={t.type} />
                  {t.checklist_total > 0 && ` ☑ ${t.checklist_done}/${t.checklist_total}`}
                  {t.comment_count > 0 && ` 💬 ${t.comment_count}`}
                </div>
              </td>
              {!hideProject && (
                <td>
                  {t.project_name ? (
                    <span style={{ color: t.project_color }}>● </span>
                  ) : null}
                  {t.project_name || <span className="muted">—</span>}
                </td>
              )}
              <td>
                <StatusPill status={t.status} />
              </td>
              <td>
                <PriorityTag priority={t.priority} />
              </td>
              <td>
                {t.assignee_name ? (
                  <span className="row gap-sm">
                    <Avatar name={t.assignee_name} color={t.assignee_color} size={22} /> {t.assignee_name}
                  </span>
                ) : (
                  <span className="muted">Unassigned</span>
                )}
              </td>
              <td>
                <DueDate task={t} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TaskFilters({ filters, setFilters, projects, people, showScope = true }) {
  const { meta } = useApp();
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  return (
    <div className="filters">
      <input className="search" placeholder="Search tasks…" value={filters.q || ''} onChange={set('q')} />
      {showScope && (
        <select value={filters.scope || ''} onChange={set('scope')}>
          <option value="">Everything I can see</option>
          <option value="mine">Assigned to me</option>
          <option value="created">Created by me</option>
          <option value="review">Waiting for my review</option>
          <option value="team">My team</option>
        </select>
      )}
      <select value={filters.status || ''} onChange={set('status')}>
        <option value="">Any status</option>
        {meta.statuses.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
      <select value={filters.priority || ''} onChange={set('priority')}>
        <option value="">Any priority</option>
        {meta.priorities.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>
      <select value={filters.type || ''} onChange={set('type')}>
        <option value="">Any type</option>
        {meta.taskTypes.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label}
          </option>
        ))}
      </select>
      {projects && (
        <select value={filters.project_id || ''} onChange={set('project_id')}>
          <option value="">Any project</option>
          <option value="none">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {people && (
        <select value={filters.assignee_id || ''} onChange={set('assignee_id')}>
          <option value="">Anyone</option>
          <option value="none">Unassigned</option>
          {people.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      )}
      <select value={filters.due || ''} onChange={set('due')}>
        <option value="">Any due date</option>
        <option value="overdue">Overdue</option>
        <option value="today">Due today</option>
        <option value="week">Due in 7 days</option>
      </select>
      {Object.values(filters).some(Boolean) && (
        <button className="link" onClick={() => setFilters({})}>
          Clear
        </button>
      )}
    </div>
  );
}
