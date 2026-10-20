import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Avatar, timeAgo, useTaskDialog } from './ui.jsx';
import TaskDetail from './TaskDetail.jsx';
import TaskForm from './TaskForm.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◧', end: true },
  { to: '/tasks', label: 'Tasks', icon: '☑' },
  { to: '/projects', label: 'Projects', icon: '▤' },
  { to: '/calendar', label: 'Calendar', icon: '▦' },
  { to: '/team', label: 'Team', icon: '☷' },
  { to: '/reports', label: 'Reports', icon: '▥' },
];

function Notifications() {
  const { version } = useApp();
  const { open: openTask } = useTaskDialog();
  const [data, setData] = useState({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const load = () => api.get('/notifications').then(setData).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [version]);

  useEffect(() => {
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const click = async (n) => {
    if (!n.read) await api.post(`/notifications/${n.id}/read`);
    setOpen(false);
    if (n.task_id) openTask(n.task_id);
    load();
  };

  return (
    <div className="notif" ref={ref}>
      <button className="icon-btn bell" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        🔔{data.unread > 0 && <span className="badge">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <strong>Notifications</strong>
            {data.unread > 0 && (
              <button className="link" onClick={() => api.post('/notifications/read-all').then(load)}>
                Mark all read
              </button>
            )}
          </div>
          {data.items.length === 0 && <div className="muted pad">You're all caught up.</div>}
          {data.items.map((n) => (
            <button key={n.id} className={`notif-item ${n.read ? '' : 'unread'}`} onClick={() => click(n)}>
              <span>{n.message}</span>
              <small className="muted">{timeAgo(n.created_at)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout({ children }) {
  const { user, logout, roleLabel, isUserAdmin, toast } = useApp();
  const { current, create } = useTaskDialog();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => setMenu(false), [location.pathname]);

  return (
    <div className={`shell ${menu ? 'menu-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">✓</span> TaskFlow
        </div>
        <button className="btn primary block" onClick={() => create()}>
          + New task
        </button>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-link">
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
          {isUserAdmin && (
            <NavLink to="/users" className="nav-link">
              <span className="nav-icon">⚙</span>
              Users
            </NavLink>
          )}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/settings" className="me">
            <Avatar name={user.name} color={user.avatar_color} size={32} />
            <div>
              <div className="me-name">{user.name}</div>
              <div className="me-role">{user.title || roleLabel(user.role)}</div>
            </div>
          </NavLink>
          <button className="link" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setMenu(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn hamburger" onClick={() => setMenu(true)} aria-label="Menu">
            ☰
          </button>
          <div className="grow" />
          <Notifications />
        </header>
        <main className="content">{children}</main>
      </div>
      {current === 'new' && <TaskForm />}
      {current && current !== 'new' && <TaskDetail id={Number(current)} />}
      {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
    </div>
  );
}
