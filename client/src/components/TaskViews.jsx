import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Avatar, DueDate, Empty, PriorityTag, StatusPill, TypeTag, useTaskDialog } from './ui.jsx';
import Icon from './Icon.jsx';

export function TaskCard({ task, draggable, compact }) {
  const { open } = useTaskDialog();
  const { t } = useApp();
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
            <span title={t('tasks.checklist')}>
              <Icon name="checklist" size={13} /> {task.checklist_done}/{task.checklist_total}
            </span>
          )}
          {task.comment_count > 0 && (
            <span title={t('tasks.comments')}>
              <Icon name="comment" size={13} /> {task.comment_count}
            </span>
          )}
          {task.reviewer_name && (
            <span title={`${t('tasks.reviewer')}: ${task.reviewer_name}`}>
              <Icon name="eye" size={13} />
            </span>
          )}
        </span>
        {task.assignee_name ? <Avatar name={task.assignee_name} color={task.assignee_color} size={24} /> : <span className="avatar empty-avatar">?</span>}
      </div>
    </div>
  );
}

export function Board({ tasks, onChanged, newTaskDefaults = {} }) {
  const { meta, notify, t } = useApp();
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
                <button className="icon-btn sm" title={t('tasks.addTask')} onClick={() => create({ ...newTaskDefaults, status: s.key })}>
                  +
                </button>
              )}
            </div>
            <div className="column-body">
              {col.map((t) => (
                <TaskCard key={t.id} task={t} draggable />
              ))}
              {col.length === 0 && <div className="column-empty">{t('tasks.dropHere')}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TaskTable({ tasks, hideProject }) {
  const { open } = useTaskDialog();
  const { t } = useApp();
  if (!tasks.length) return <Empty>{t('tasks.none')}</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t('tasks.task')}</th>
            {!hideProject && <th>{t('tasks.project')}</th>}
            <th>{t('tasks.status')}</th>
            <th>{t('tasks.priority')}</th>
            <th>{t('tasks.assignee')}</th>
            <th>{t('tasks.due')}</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} onClick={() => open(task.id)} className="clickable">
              <td>
                <div className="cell-title">{task.title}</div>
                <div className="muted sm">
                  <TypeTag type={task.type} />
                  {task.checklist_total > 0 && (
                    <span className="inline-meta">
                      <Icon name="checklist" size={13} /> {task.checklist_done}/{task.checklist_total}
                    </span>
                  )}
                  {task.comment_count > 0 && (
                    <span className="inline-meta">
                      <Icon name="comment" size={13} /> {task.comment_count}
                    </span>
                  )}
                </div>
              </td>
              {!hideProject && (
                <td>
                  {task.project_name ? (
                    <span style={{ color: task.project_color }}>● </span>
                  ) : null}
                  {task.project_name || <span className="muted">—</span>}
                </td>
              )}
              <td>
                <StatusPill status={task.status} />
              </td>
              <td>
                <PriorityTag priority={task.priority} />
              </td>
              <td>
                {task.assignee_name ? (
                  <span className="row gap-sm">
                    <Avatar name={task.assignee_name} color={task.assignee_color} size={22} /> {task.assignee_name}
                  </span>
                ) : (
                  <span className="muted">{t('common.unassigned')}</span>
                )}
              </td>
              <td>
                <DueDate task={task} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TaskFilters({ filters, setFilters, projects, people, showScope = true }) {
  const { meta, t, statusLabel, priorityLabel, typeLabel } = useApp();
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  return (
    <div className="filters">
      <input className="search" placeholder={t('filter.search')} value={filters.q || ''} onChange={set('q')} />
      {showScope && (
        <select value={filters.scope || ''} onChange={set('scope')}>
          <option value="">{t('filter.everything')}</option>
          <option value="mine">{t('filter.mine')}</option>
          <option value="created">{t('filter.created')}</option>
          <option value="review">{t('filter.review')}</option>
          <option value="team">{t('filter.team')}</option>
        </select>
      )}
      <select value={filters.status || ''} onChange={set('status')}>
        <option value="">{t('filter.anyStatus')}</option>
        {meta.statuses.map((s) => (
          <option key={s.key} value={s.key}>
            {statusLabel(s.key)}
          </option>
        ))}
      </select>
      <select value={filters.priority || ''} onChange={set('priority')}>
        <option value="">{t('filter.anyPriority')}</option>
        {meta.priorities.map((p) => (
          <option key={p.key} value={p.key}>
            {priorityLabel(p.key)}
          </option>
        ))}
      </select>
      <select value={filters.type || ''} onChange={set('type')}>
        <option value="">{t('filter.anyType')}</option>
        {meta.taskTypes.map((x) => (
          <option key={x.key} value={x.key}>
            {typeLabel(x.key)}
          </option>
        ))}
      </select>
      {projects && (
        <select value={filters.project_id || ''} onChange={set('project_id')}>
          <option value="">{t('filter.anyProject')}</option>
          <option value="none">{t('filter.noProject')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {people && (
        <select value={filters.assignee_id || ''} onChange={set('assignee_id')}>
          <option value="">{t('filter.anyone')}</option>
          <option value="none">{t('common.unassigned')}</option>
          {people.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      )}
      <select value={filters.due || ''} onChange={set('due')}>
        <option value="">{t('filter.anyDue')}</option>
        <option value="overdue">{t('filter.overdue')}</option>
        <option value="today">{t('filter.today')}</option>
        <option value="week">{t('filter.week')}</option>
      </select>
      {Object.values(filters).some(Boolean) && (
        <button className="link" onClick={() => setFilters({})}>
          {t('common.clear')}
        </button>
      )}
    </div>
  );
}
