import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { ActivityText } from '../components/TaskDetail.jsx';
import { Board, TaskFilters, TaskTable } from '../components/TaskViews.jsx';
import { Avatar, DeptTag, Progress, formatDate, timeAgo, useTaskDialog } from '../components/ui.jsx';
import { ProjectForm } from './Projects.jsx';

export default function ProjectDetail() {
  const { id } = useParams();
  const { version, refresh, roleLabel, notify, t, projectStatusLabel } = useApp();
  const { create } = useTaskDialog();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');
  const [view, setView] = useState('board');
  const [filters, setFilters] = useState({});
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api
      .get(`/projects/${id}`)
      .then(setProject)
      .catch((e) => setError(e.message));
  }, [id, version]);

  useEffect(() => {
    api.get('/tasks', { ...filters, project_id: id }).then(setTasks);
  }, [id, version, JSON.stringify(filters)]);

  if (error)
    return (
      <div className="page">
        <div className="alert error">{error}</div>
        <Link to="/projects">{t('proj.back')}</Link>
      </div>
    );
  if (!project) return <div className="muted">{t('common.loading')}</div>;

  const remove = async () => {
    if (!confirm(t('proj.confirmDelete', { name: project.name }))) return;
    await api.del(`/projects/${project.id}`);
    notify(t('proj.deleted'));
    refresh();
    navigate('/projects');
  };

  return (
    <div className="page">
      <Link to="/projects" className="muted sm">
        {t('proj.back')}
      </Link>
      <div className="page-head">
        <div>
          <h1 className="row gap-sm">
            <span className="dot" style={{ background: project.color }} /> {project.name}
          </h1>
          <div className="row gap wrap sm">
            <DeptTag department={project.department} />
            <span className={`pill pstatus-${project.status}`}>{projectStatusLabel(project.status)}</span>
            <span className="muted">{t('proj.ownerName', { name: project.owner_name })}</span>
            {project.due_date && <span className="muted">{t('proj.dueOn', { date: formatDate(project.due_date) })}</span>}
          </div>
        </div>
        <div className="row gap">
          {project.can_manage && (
            <>
              <button className="btn" onClick={() => setEditing(true)}>
                {t('common.edit')}
              </button>
              <button className="btn danger" onClick={remove}>
                {t('common.delete')}
              </button>
            </>
          )}
          <button className="btn primary" onClick={() => create({ project_id: project.id })}>
            {t('proj.addTask')}
          </button>
        </div>
      </div>
      {project.description && <p className="muted">{project.description}</p>}

      <div className="project-summary">
        <div className="grow">
          <Progress value={project.done_count} total={project.task_count} color={project.color} />
          <div className="muted sm">
            {t('proj.tasksDone', { done: project.done_count, total: project.task_count })}
            {project.overdue_count > 0 && <span className="text-danger"> · {t('proj.overdue', { n: project.overdue_count })}</span>}
          </div>
        </div>
        <div className="avatars">
          {project.members.map((m) => (
            <Avatar key={m.id} name={m.name} color={m.avatar_color} size={28} title={`${m.name} — ${m.title || roleLabel(m.role)}`} />
          ))}
        </div>
      </div>

      <div className="row between wrap">
        <TaskFilters filters={filters} setFilters={setFilters} people={project.members} showScope={false} />
        <div className="seg">
          <button className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}>
            {t('tasks.board')}
          </button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            {t('tasks.list')}
          </button>
          <button className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}>
            {t('task.activity')}
          </button>
        </div>
      </div>

      {view === 'board' && <Board tasks={tasks} onChanged={refresh} newTaskDefaults={{ project_id: project.id }} />}
      {view === 'list' && <TaskTable tasks={tasks} hideProject />}
      {view === 'activity' && (
        <ul className="activity panel">
          {project.activity.map((a) => (
            <li key={a.id}>
              <strong>{a.user_name}</strong>{' '}
              {a.action.startsWith('project_') ? <span>{a.action === 'project_created' ? t('act.projectCreated') : t('act.projectStatus', { status: projectStatusLabel(a.detail) })}</span> : <ActivityText a={a} withTask />}{' '}
              <small className="muted">{timeAgo(a.created_at)}</small>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ProjectForm
          project={project}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
            notify(t('proj.saved'), 'success');
          }}
        />
      )}
    </div>
  );
}
