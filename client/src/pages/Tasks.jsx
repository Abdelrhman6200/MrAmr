import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Board, TaskFilters, TaskTable } from '../components/TaskViews.jsx';

const FILTER_KEYS = ['q', 'scope', 'status', 'priority', 'type', 'project_id', 'assignee_id', 'due'];

function readView() {
  try {
    return localStorage.getItem('taskflow.view') || 'board';
  } catch {
    return 'board';
  }
}

export default function Tasks() {
  const { version, refresh, users } = useApp();
  const [params, setParams] = useSearchParams();
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [view, setView] = useState(readView);
  const [loading, setLoading] = useState(true);

  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || '']).filter(([, v]) => v));
  const setFilters = (f) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      FILTER_KEYS.forEach((k) => (f[k] ? n.set(k, f[k]) : n.delete(k)));
      return n;
    });
  const key = FILTER_KEYS.map((k) => params.get(k)).join('|');

  useEffect(() => {
    api.get('/projects').then(setProjects).catch(() => {});
  }, [version]);

  useEffect(() => {
    // Debounce typing in the search box.
    const t = setTimeout(() => {
      api
        .get('/tasks', filters)
        .then(setTasks)
        .finally(() => setLoading(false));
    }, 150);
    return () => clearTimeout(t);
  }, [key, version]);

  const switchView = (v) => {
    setView(v);
    try {
      localStorage.setItem('taskflow.view', v);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Tasks</h1>
        <div className="seg">
          <button className={view === 'board' ? 'active' : ''} onClick={() => switchView('board')}>
            Board
          </button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => switchView('list')}>
            List
          </button>
        </div>
      </div>
      <TaskFilters filters={filters} setFilters={setFilters} projects={projects} people={users} />
      <div className="muted sm results">{loading ? 'Loading…' : `${tasks.length} task${tasks.length === 1 ? '' : 's'}`}</div>
      {view === 'board' ? (
        <Board tasks={tasks} onChanged={refresh} newTaskDefaults={{ project_id: filters.project_id && filters.project_id !== 'none' ? filters.project_id : null }} />
      ) : (
        <TaskTable tasks={tasks} />
      )}
    </div>
  );
}
